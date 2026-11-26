import { Hono } from 'hono';
import {
  AppError,
  discordWebhookConfigSchema,
  hasRoleAtLeast,
  notificationPrefsSchema,
  pushSubscriptionSchema,
  type NotificationChannel,
  type NotificationPrefs,
  type NotificationRecord,
  type NotificationTier,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { requireWriterRole } from '../auth.js';
import { encryptSecret } from '../crypto.js';

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
        `SELECT hourly_budget, quiet_start_hour, quiet_end_hour, timezone, snooze_until
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
        }
      : notificationPrefsSchema.parse({});

    return c.json({
      notifications: (notifRes.results ?? []).map(mapNotificationRow),
      prefs,
      discordConfigured: wsRow?.has_discord === 1,
      source: 'd1',
      asOf: new Date().toISOString(),
    });
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
         (workspace_id, user_id, hourly_budget, quiet_start_hour, quiet_end_hour, timezone, snooze_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET
         hourly_budget = excluded.hourly_budget,
         quiet_start_hour = excluded.quiet_start_hour,
         quiet_end_hour = excluded.quiet_end_hour,
         timezone = excluded.timezone,
         snooze_until = excluded.snooze_until,
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
