import { describe, expect, it, vi } from 'vitest';
import type { NotifyQueueMessage } from '@clipse/core';
import {
  buildDiscordWebhookPayload,
  formatDiscordDailyDigestEmbed,
  processNotifyBatch,
  processUnclaimedEscalations,
  sendDiscordDailyDigest,
  sendDiscordWebhook,
  type NotifyEnv,
} from './notify.js';

function createNotifyMockDb(options?: {
  hourlyBudget?: number;
  quietStartHour?: number | null;
  quietEndHour?: number | null;
  sentLastHour?: number;
  discordWebhookEnc?: string | null;
  escalationRows?: Array<{
    id: string;
    workspace_id: string;
    item_id: string;
    type: string;
    confidence: string;
    reason: string;
    created_at: string;
    reminded_at: string | null;
  }>;
}) {
  const insertedNotifications: Array<{ id: string; channel: string; tier: string }> = [];
  const deliveryLogs: Array<{ id: string; channel: string; status: string; reason: string | null }> = [];
  const remindedAlerts = new Set<string>();

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM notification_prefs')) {
                return {
                  hourly_budget: options?.hourlyBudget ?? 10,
                  quiet_start_hour: options?.quietStartHour ?? null,
                  quiet_end_hour: options?.quietEndHour ?? null,
                  timezone: 'UTC',
                  snooze_until: null,
                } as T;
              }
              if (sql.includes('SELECT COUNT(*) AS cnt FROM notifications')) {
                return { cnt: options?.sentLastHour ?? 0 } as T;
              }
              if (sql.includes('SELECT id FROM notifications WHERE id = ?')) {
                const id = String(args[0]);
                const found = insertedNotifications.find((n) => n.id === id);
                return (found ? { id: found.id } : null) as T | null;
              }
              if (sql.includes('SELECT discord_webhook_enc FROM workspaces')) {
                return { discord_webhook_enc: options?.discordWebhookEnc ?? null } as T;
              }
              return null;
            },
            async all<T>() {
              if (sql.includes('FROM push_subscriptions')) {
                return { results: [] as T[] };
              }
              return { results: [] as T[] };
            },
            async run() {
              if (sql.includes('INSERT OR IGNORE INTO notifications')) {
                const id = String(args[0]);
                const tier = String(args[4]);
                const channel = String(args[5]);
                if (!insertedNotifications.some((n) => n.id === id)) {
                  insertedNotifications.push({ id, channel, tier });
                }
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.includes('INSERT OR IGNORE INTO alert_deliveries')) {
                deliveryLogs.push({
                  id: String(args[0]),
                  channel: String(args[3]),
                  status: String(args[4]),
                  reason: args[5] ? String(args[5]) : null,
                });
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE alerts SET reminded_at = ?')) {
                const alertId = String(args[1]);
                if (remindedAlerts.has(alertId)) {
                  return { success: true, meta: { changes: 0 } };
                }
                remindedAlerts.add(alertId);
                return { success: true, meta: { changes: 1 } };
              }
              return { success: true, meta: { changes: 0 } };
            },
          };
        },
        async all<T>() {
          if (sql.includes('FROM alerts a')) {
            const rows = (options?.escalationRows ?? []).filter((r) => !remindedAlerts.has(r.id));
            return { results: rows as T[] };
          }
          return { results: [] as T[] };
        },
      };
    },
  } as unknown as D1Database;

  return { db, insertedNotifications, deliveryLogs, remindedAlerts };
}

const baseMsg: NotifyQueueMessage = {
  type: 'dispatch_alert',
  idempotencyKey: 'key-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  alertId: 'alert-1',
  alertType: 'live_moment',
  confidence: 'high',
  title: 'Crazy clutch @everyone @here <@&999>',
  body: '5 clips from 4 creators in 3m',
  deepLinkUrl: 'https://radar.example/live',
  isEscalation: false,
  createdAt: '2026-11-26T12:00:00Z',
};

describe('engine notify consumer', () => {
  it('escapes mention injections and sets allowed_mentions parse: [] in Discord payload', () => {
    const payload = buildDiscordWebhookPayload(baseMsg) as {
      allowed_mentions: { parse: string[] };
      embeds: Array<{ title: string }>;
    };
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0]?.title).not.toContain('@everyone');
    expect(payload.embeds[0]?.title).not.toContain('@here');
    expect(payload.embeds[0]?.title).toContain('@\u200beveryone');
  });

  it('honours Discord 429 Retry-After header', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '12' },
      });
    });

    const result = await sendDiscordWebhook(
      'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456',
      baseMsg,
      fetchMock as unknown as typeof fetch,
    );

    expect(result.delivered).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.retryAfterSeconds).toBe(12);
  });

  it('suppresses Discord delivery on hourly budget exhaustion and quiet hours while saving in-app', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const { db, insertedNotifications, deliveryLogs } = createNotifyMockDb({
      hourlyBudget: 3,
      sentLastHour: 3,
      quietStartHour: 11,
      quietEndHour: 14,
    });
    const env: NotifyEnv = {
      DB: db,
      ENVIRONMENT: 'local',
      DISCORD_WEBHOOK_URL:
        'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456',
    };

    const res = await processNotifyBatch(db, env, [baseMsg], {
      fetchImpl: fetchMock as unknown as typeof fetch,
      nowIso: '2026-11-26T12:00:00Z',
    });

    expect(res.processed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(insertedNotifications).toHaveLength(1);
    expect(insertedNotifications[0]?.channel).toBe('in_app');
    expect(deliveryLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'in_app', status: 'delivered' }),
        expect.objectContaining({
          channel: 'discord',
          status: 'suppressed',
          reason: 'quiet_hours,hourly_budget_exceeded',
        }),
      ]),
    );
  });

  it('sends unclaimed escalation reminder at most once', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const { db, remindedAlerts } = createNotifyMockDb({
      escalationRows: [
        {
          id: 'alert-esc-1',
          workspace_id: 'ws-1',
          item_id: 'item-1',
          type: 'live_moment',
          confidence: 'high',
          reason: '5 clips from 4 creators',
          created_at: '2026-11-26T11:40:00Z',
          reminded_at: null,
        },
      ],
    });
    const env: NotifyEnv = {
      DB: db,
      ENVIRONMENT: 'local',
      DISCORD_WEBHOOK_URL:
        'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456',
    };

    const first = await processUnclaimedEscalations(
      db,
      env,
      '2026-11-26T12:00:00Z',
      fetchMock as unknown as typeof fetch,
    );
    const second = await processUnclaimedEscalations(
      db,
      env,
      '2026-11-26T12:05:00Z',
      fetchMock as unknown as typeof fetch,
    );

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(remindedAlerts.has('alert-esc-1')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('formats and sends Discord Daily Digest with mention escaping and 429 Retry-After', async () => {
    const embed = formatDiscordDailyDigestEmbed({
      workspaceName: 'Team @everyone',
      dateLabel: '2026-11-26',
      totalAlerts: 4,
      claimedCount: 3,
      clippedCount: 2,
      topItems: [
        {
          creatorName: 'Streamer @here',
          title: 'Big Clutch <@&123>',
          tierLabel: 'Breakout',
          reason: '3.2x usual',
          url: 'https://www.youtube.com/watch?v=abc',
        },
      ],
      dashboardUrl: 'https://radar.example/reports',
    }) as { allowed_mentions: { parse: string[] }; embeds: Array<{ title: string; description: string }> };

    expect(embed.allowed_mentions).toEqual({ parse: [] });
    expect(embed.embeds[0]?.title).not.toContain('@everyone');
    expect(embed.embeds[0]?.description).not.toContain('@here');

    const rateLimitedFetch = vi.fn(
      async () => new Response('slow down', { status: 429, headers: { 'Retry-After': '9' } }),
    );
    const res = await sendDiscordDailyDigest(
      'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456',
      {
        workspaceName: 'Team',
        dateLabel: '2026-11-26',
        totalAlerts: 0,
        claimedCount: 0,
        clippedCount: 0,
        topItems: [],
      },
      rateLimitedFetch as unknown as typeof fetch,
    );
    expect(res.delivered).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.retryAfterSeconds).toBe(9);
  });
});
