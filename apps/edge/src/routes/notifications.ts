import { Hono } from 'hono';
import {
  alertDeliveryStatusSchema,
  alertRulesMapSchema,
  AppError,
  discordWebhookConfigSchema,
  hasRoleAtLeast,
  notificationPrefsSchema,
  pushSubscriptionSchema,
  testNotificationSchema,
  type AlertDeliveryRecord,
  type AlertRulesMap,
  type NotificationChannel,
  type NotificationPrefs,
  type NotificationRecord,
  type NotificationTier,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { requireWriterRole } from '../auth.js';
import { decryptSecret, encryptSecret } from '../crypto.js';

interface NotificationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  alert_id: string | null;
  tier: NotificationTier;
  channel: NotificationChannel;
  title: string;
  body: string;
  read_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

interface PrefsRow {
  hourly_budget: number;
  quiet_start_hour: number | null;
  quiet_end_hour: number | null;
  timezone: string;
  snooze_until: string | null;
  discord_daily_digest: number;
  rules_json: string;
}

function mapNotificationRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    alertId: row.alert_id,
    tier: row.tier,
    channel: row.channel,
    title: row.title,
    body: row.body,
    readAt: row.read_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  };
}

function parseRulesJson(raw: string): AlertRulesMap | undefined {
  try {
    const parsed = alertRulesMapSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function resolveEncryptionKey(env: EdgeBindings): string {
  if (env.WEBHOOK_ENCRYPTION_KEY && env.WEBHOOK_ENCRYPTION_KEY.length >= 16) {
    return env.WEBHOOK_ENCRYPTION_KEY;
  }
  if ((env.ENVIRONMENT ?? 'local') === 'local') {
    return 'local-dev-ephemeral-webhook-key';
  }
  throw AppError.internal('WEBHOOK_ENCRYPTION_KEY is not configured');
}

export function createNotificationsRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');

    const [notifRes, prefsRow, wsRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, workspace_id, user_id, alert_id, tier, channel, title, body, read_at, delivered_at, created_at
         FROM notifications
         WHERE workspace_id = ? AND user_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
      )
        .bind(principal.workspaceId, principal.userId)
        .all<NotificationRow>(),
      c.env.DB.prepare(
        `SELECT hourly_budget, quiet_start_hour, quiet_end_hour, timezone, snooze_until,
                discord_daily_digest, rules_json
         FROM notification_prefs
         WHERE workspace_id = ? AND user_id = ?`,
      )
        .bind(principal.workspaceId, principal.userId)
        .first<PrefsRow>(),
      c.env.DB.prepare(
        'SELECT discord_webhook_enc IS NOT NULL AS has_discord FROM workspaces WHERE id = ?',
      )
        .bind(principal.workspaceId)
        .first<{ has_discord: number }>(),
    ]);

    const prefs: NotificationPrefs = prefsRow
      ? {
          hourlyBudget: prefsRow.hourly_budget,
          quietStartHour: prefsRow.quiet_start_hour,
          quietEndHour: prefsRow.quiet_end_hour,
          timezone: prefsRow.timezone,
          snoozeUntil: prefsRow.snooze_until,
          discordDailyDigest: prefsRow.discord_daily_digest === 1,
          rules: parseRulesJson(prefsRow.rules_json),
        }
      : notificationPrefsSchema.parse({});

    return c.json({
      notifications: (notifRes.results ?? []).map(mapNotificationRow),
      prefs,
      discordConfigured: Boolean(wsRow?.has_discord === 1 || c.env.DISCORD_WEBHOOK_URL),
      source: 'Clipse Notification Engine',
      asOf: new Date().toISOString(),
    });
  });

  router.get('/deliveries', async (c) => {
    const principal = c.get('principal');

    const res = await c.env.DB.prepare(
      `SELECT id, alert_id, channel, status, reason, attempted_at, delivered_at
       FROM alert_deliveries
       WHERE workspace_id = ?
       ORDER BY attempted_at DESC
       LIMIT 100`,
    )
      .bind(principal.workspaceId)
      .all<{
        id: string;
        alert_id: string | null;
        channel: string;
        status: string;
        reason: string | null;
        attempted_at: string;
        delivered_at: string | null;
      }>();

    const deliveries: AlertDeliveryRecord[] = [];
    for (const r of res.results ?? []) {
      const st = alertDeliveryStatusSchema.safeParse(r.status);
      if (!st.success) continue;
      deliveries.push({
        id: r.id,
        alertId: r.alert_id,
        channel: r.channel,
        status: st.data,
        reason: r.reason,
        attemptedAt: r.attempted_at,
        deliveredAt: r.delivered_at,
      });
    }

    return c.json({
      deliveries,
      source: 'Clipse Notification Engine',
      asOf: new Date().toISOString(),
    });
  });

  router.post('/test', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const body = testNotificationSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid test notification channel', body.error.flatten());
    }

    const channel = body.data.channel;
    const nowIso = new Date().toISOString();
    const deliveryId = crypto.randomUUID();
    let ok = false;
    let status: 'delivered' | 'failed' = 'failed';
    let message = '';

    if (channel === 'in_app') {
      await c.env.DB.prepare(
        `INSERT INTO notifications (id, workspace_id, user_id, alert_id, tier, channel, title, body, delivered_at, created_at)
         VALUES (?, ?, ?, NULL, 'P2', 'in_app', ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          principal.workspaceId,
          principal.userId,
          'Test Notification',
          `In-app delivery verified for ${principal.email}`,
          nowIso,
          nowIso,
        )
        .run();
      ok = true;
      status = 'delivered';
      message = 'In-app test notification delivered';
    } else if (channel === 'discord') {
      const wsRow = await c.env.DB.prepare(
        'SELECT discord_webhook_enc FROM workspaces WHERE id = ?',
      )
        .bind(principal.workspaceId)
        .first<{ discord_webhook_enc: string | null }>();

      let webhookUrl = c.env.DISCORD_WEBHOOK_URL;
      if (wsRow?.discord_webhook_enc) {
        webhookUrl = await decryptSecret(
          wsRow.discord_webhook_enc,
          resolveEncryptionKey(c.env),
        );
      }

      if (!webhookUrl) {
        message = 'Discord webhook is not configured';
      } else {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: 'Clipse Radar test notification — channel delivery verified.',
            allowed_mentions: { parse: [] },
          }),
        });
        ok = res.ok;
        status = res.ok ? 'delivered' : 'failed';
        message = res.ok
          ? `Discord webhook delivered (HTTP ${res.status})`
          : `Discord webhook returned HTTP ${res.status}`;
      }
    } else {
      const subCount = await c.env.DB.prepare(
        'SELECT COUNT(*) AS cnt FROM push_subscriptions WHERE workspace_id = ? AND user_id = ?',
      )
        .bind(principal.workspaceId, principal.userId)
        .first<{ cnt: number }>();

      if ((subCount?.cnt ?? 0) > 0) {
        ok = true;
        status = 'delivered';
        message = `Web Push subscription verified (${subCount?.cnt} active endpoint)`;
      } else {
        message = 'No Web Push subscription registered for this user';
      }
    }

    await c.env.DB.prepare(
      `INSERT INTO alert_deliveries (id, workspace_id, alert_id, channel, status, reason, attempted_at, delivered_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
      .bind(
        deliveryId,
        principal.workspaceId,
        channel,
        status,
        message,
        nowIso,
        status === 'delivered' ? nowIso : null,
      )
      .run();

    return c.json({ ok, channel, status, message, attemptedAt: nowIso });
  });

  router.post('/:id/read', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const id = c.req.param('id');
    const now = new Date().toISOString();

    const res = await c.env.DB.prepare(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, ?)
       WHERE id = ? AND workspace_id = ? AND user_id = ?`,
    )
      .bind(now, id, principal.workspaceId, principal.userId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      throw AppError.notFound('Notification not found');
    }

    return c.json({ ok: true, id, readAt: now });
  });

  router.put('/prefs', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const body = notificationPrefsSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid notification preferences', body.error.flatten());
    }

    const now = new Date().toISOString();
    const p = body.data;
    await c.env.DB.prepare(
      `INSERT INTO notification_prefs
         (workspace_id, user_id, hourly_budget, quiet_start_hour, quiet_end_hour, timezone, snooze_until, discord_daily_digest, rules_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET
         hourly_budget = excluded.hourly_budget,
         quiet_start_hour = excluded.quiet_start_hour,
         quiet_end_hour = excluded.quiet_end_hour,
         timezone = excluded.timezone,
         snooze_until = excluded.snooze_until,
         discord_daily_digest = excluded.discord_daily_digest,
         rules_json = excluded.rules_json,
         updated_at = excluded.updated_at`,
    )
      .bind(
        principal.workspaceId,
        principal.userId,
        p.hourlyBudget,
        p.quietStartHour,
        p.quietEndHour,
        p.timezone,
        p.snoozeUntil,
        p.discordDailyDigest ? 1 : 0,
        JSON.stringify(p.rules ?? {}),
        now,
      )
      .run();

    return c.json({ prefs: p });
  });

  router.post('/push', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const body = pushSubscriptionSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid push subscription', body.error.flatten());
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (id, workspace_id, user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, user_id, endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth`,
    )
      .bind(
        id,
        principal.workspaceId,
        principal.userId,
        body.data.endpoint,
        body.data.keys.p256dh,
        body.data.keys.auth,
        now,
      )
      .run();

    return c.json({ ok: true }, 201);
  });

  router.put('/discord', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('Only workspace Admins or Owners can configure Discord webhooks');
    }

    const body = discordWebhookConfigSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid Discord webhook URL', body.error.flatten());
    }

    const encrypted = body.data.webhookUrl
      ? await encryptSecret(body.data.webhookUrl, resolveEncryptionKey(c.env))
      : null;

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE workspaces SET discord_webhook_enc = ?, updated_at = ? WHERE id = ?',
    )
      .bind(encrypted, now, principal.workspaceId)
      .run();

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'discord_webhook.updated', 'workspace', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        principal.workspaceId,
        principal.userId,
        principal.workspaceId,
        JSON.stringify({ configured: encrypted !== null }),
        now,
      )
      .run();

    return c.json({ ok: true, discordConfigured: encrypted !== null });
  });

  return router;
}
