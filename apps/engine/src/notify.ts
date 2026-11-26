import {
  escapeDiscordMarkdown,
  evaluateNotification,
  notificationPrefsSchema,
  notifyQueueMessageSchema,
  shouldEscalateUnclaimed,
  validateDiscordWebhookUrl,
  type AlertConfidence,
  type AlertType,
  type NotificationPrefs,
  type NotificationTier,
  type NotifyDeliveryResult,
  type NotifyQueueMessage,
} from '@clipse/core';

export interface NotifyEnv {
  DB: D1Database;
  ENVIRONMENT: string;
  WEBHOOK_ENCRYPTION_KEY?: string;
  DISCORD_WEBHOOK_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  APP_BASE_URL?: string;
}

export interface NotifyBatchResult {
  readonly processed: number;
  readonly failed: number;
  readonly skippedInvalid: number;
  readonly retryAfterSeconds: number | null;
}

interface PrefsRow {
  hourly_budget: number;
  quiet_start_hour: number | null;
  quiet_end_hour: number | null;
  timezone: string;
  snooze_until: string | null;
}

interface PushSubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const TIER_COLORS: Record<NotificationTier, number> = {
  P1: 0xf0455a,
  P2: 0x18b9cc,
  P3: 0x2fd08a,
};

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decrypts AES-GCM `v1.<iv>.<ciphertext>` secret stored by edge Worker.
 */
export async function decryptWebhookSecret(
  token: string,
  secretMaterial: string,
): Promise<string> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Unsupported encrypted secret format');
  }
  const iv = fromBase64Url(parts[1] ?? '');
  const ciphertext = fromBase64Url(parts[2] ?? '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretMaterial));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}

function resolveEncryptionKey(env: NotifyEnv): string | null {
  if (env.WEBHOOK_ENCRYPTION_KEY && env.WEBHOOK_ENCRYPTION_KEY.length >= 16) {
    return env.WEBHOOK_ENCRYPTION_KEY;
  }
  if (env.ENVIRONMENT === 'local') {
    return 'local-dev-ephemeral-webhook-key';
  }
  return null;
}

/**
 * Builds a Discord webhook payload with mention-injection neutralization and embed.
 */
export function buildDiscordWebhookPayload(msg: NotifyQueueMessage): Record<string, unknown> {
  const safeTitle = escapeDiscordMarkdown(msg.title).slice(0, 240);
  const safeBody = escapeDiscordMarkdown(msg.body).slice(0, 1000);
  const deepLink =
    msg.deepLinkUrl && msg.deepLinkUrl.startsWith('https://') ? msg.deepLinkUrl : undefined;

  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `[${msg.isEscalation ? 'REMINDER' : msg.alertType.toUpperCase()}] ${safeTitle}`,
        description: deepLink ? `${safeBody}\n\n[Open in Clipse Radar](${deepLink})` : safeBody,
        url: deepLink,
        color: TIER_COLORS[msg.isEscalation ? 'P1' : 'P2'],
        footer: { text: `Confidence: ${msg.confidence}` },
        timestamp: msg.createdAt,
      },
    ],
  };
}

function parseRetryAfter(headerValue: string | null): number {
  if (!headerValue) return 5;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(300, Math.ceil(seconds));
  }
  return 5;
}

export async function sendDiscordWebhook(
  webhookUrl: string,
  msg: NotifyQueueMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<NotifyDeliveryResult> {
  const check = validateDiscordWebhookUrl(webhookUrl);
  if (!check.valid) {
    return { delivered: false, statusCode: 400 };
  }

  const response = await fetchImpl(check.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildDiscordWebhookPayload(msg)),
    redirect: 'error',
  });

  if (response.status === 429) {
    return {
      delivered: false,
      statusCode: 429,
      retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
    };
  }

  return {
    delivered: response.ok,
    statusCode: response.status,
  };
}

async function createVapidJwt(
  endpoint: string,
  subject: string,
  privateKeyPkcs8B64Url: string,
): Promise<string> {
  const origin = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const enc = new TextEncoder();
  const header = toBase64Url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(enc.encode(JSON.stringify({ aud: origin, exp, sub: subject })));
  const signingInput = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    fromBase64Url(privateKeyPkcs8B64Url),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(signingInput),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function sendWebPush(
  sub: PushSubRow,
  env: NotifyEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<NotifyDeliveryResult> {
  if (!sub.endpoint.startsWith('https://')) {
    return { delivered: false, statusCode: 400 };
  }
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return { delivered: false, statusCode: 501 };
  }

  const jwt = await createVapidJwt(sub.endpoint, env.VAPID_SUBJECT, env.VAPID_PRIVATE_KEY);
  const response = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      TTL: '300',
    },
    redirect: 'error',
  });

  if (response.status === 429) {
    return {
      delivered: false,
      statusCode: 429,
      retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
    };
  }
  return { delivered: response.ok, statusCode: response.status };
}

async function loadUserPrefs(
  db: D1Database,
  workspaceId: string,
  userId: string,
): Promise<NotificationPrefs> {
  const row = await db
    .prepare(
      `SELECT hourly_budget, quiet_start_hour, quiet_end_hour, timezone, snooze_until
       FROM notification_prefs WHERE workspace_id = ? AND user_id = ? LIMIT 1`,
    )
    .bind(workspaceId, userId)
    .first<PrefsRow>();

  if (!row) return notificationPrefsSchema.parse({});
  return {
    hourlyBudget: row.hourly_budget,
    quietStartHour: row.quiet_start_hour,
    quietEndHour: row.quiet_end_hour,
    timezone: row.timezone,
    snoozeUntil: row.snooze_until,
  };
}

async function countRecentNotifications(
  db: D1Database,
  workspaceId: string,
  userId: string,
  nowIso: string,
): Promise<number> {
  const oneHourAgo = new Date(Date.parse(nowIso) - 3600_000).toISOString();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM notifications
       WHERE workspace_id = ? AND user_id = ? AND channel IN ('discord', 'webpush') AND created_at >= ?`,
    )
    .bind(workspaceId, userId, oneHourAgo)
    .first<{ cnt: number }>();
  return Number(row?.cnt ?? 0);
}

async function resolveWorkspaceDiscordUrl(
  db: D1Database,
  env: NotifyEnv,
  workspaceId: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT discord_webhook_enc FROM workspaces WHERE id = ? LIMIT 1')
    .bind(workspaceId)
    .first<{ discord_webhook_enc: string | null }>();

  if (row?.discord_webhook_enc) {
    const key = resolveEncryptionKey(env);
    if (!key) return null;
    try {
      return await decryptWebhookSecret(row.discord_webhook_enc, key);
    } catch {
      return null;
    }
  }
  return env.DISCORD_WEBHOOK_URL ?? null;
}

async function insertNotificationRow(
  db: D1Database,
  msg: NotifyQueueMessage,
  tier: NotificationTier,
  channel: 'in_app' | 'discord' | 'webpush',
  deliveredAt: string | null,
): Promise<void> {
  const id = `notif:${channel}:${msg.idempotencyKey}`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO notifications
       (id, workspace_id, user_id, alert_id, tier, channel, title, body, delivered_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      msg.workspaceId,
      msg.userId,
      msg.alertId,
      tier,
      channel,
      msg.title,
      msg.body,
      deliveredAt,
      msg.createdAt,
    )
    .run();
}

export async function processNotifyBatch(
  db: D1Database,
  env: NotifyEnv,
  rawBodies: readonly unknown[],
  deps: { fetchImpl?: typeof fetch; nowIso?: string } = {},
): Promise<NotifyBatchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowIso = deps.nowIso ?? new Date().toISOString();
  let processed = 0;
  let failed = 0;
  let skippedInvalid = 0;
  let maxRetryAfter: number | null = null;

  for (const raw of rawBodies) {
    const parsed = notifyQueueMessageSchema.safeParse(raw);
    if (!parsed.success) {
      skippedInvalid += 1;
      continue;
    }
    const msg = parsed.data;
    try {
      const [prefs, sentLastHourCount, existing] = await Promise.all([
        loadUserPrefs(db, msg.workspaceId, msg.userId),
        countRecentNotifications(db, msg.workspaceId, msg.userId, nowIso),
        db
          .prepare('SELECT id FROM notifications WHERE id = ? LIMIT 1')
          .bind(`notif:in_app:${msg.idempotencyKey}`)
          .first<{ id: string }>(),
      ]);

      const decision = evaluateNotification({
        alertType: msg.alertType,
        confidence: msg.confidence,
        isEscalation: msg.isEscalation,
        sourceRule: msg.sourceRule,
        prefs,
        sentLastHourCount,
        dedupeKey: msg.idempotencyKey,
        recentDedupeKeys: existing ? [msg.idempotencyKey] : [],
        nowIso,
      });

      if (decision.deliverInApp) {
        await insertNotificationRow(db, msg, decision.tier, 'in_app', nowIso);
      }

      if (decision.deliverDiscord) {
        const webhookUrl = await resolveWorkspaceDiscordUrl(db, env, msg.workspaceId);
        if (webhookUrl) {
          const res = await sendDiscordWebhook(webhookUrl, msg, fetchImpl);
          if (res.statusCode === 429 && res.retryAfterSeconds) {
            failed += 1;
            maxRetryAfter = Math.max(maxRetryAfter ?? 0, res.retryAfterSeconds);
            continue;
          }
          if (res.delivered) {
            await insertNotificationRow(db, msg, decision.tier, 'discord', nowIso);
          }
        }
      }

      if (decision.deliverWebPush && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
        const subs = await db
          .prepare(
            'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE workspace_id = ? AND user_id = ?',
          )
          .bind(msg.workspaceId, msg.userId)
          .all<PushSubRow>();
        for (const sub of subs.results ?? []) {
          const pushRes = await sendWebPush(sub, env, fetchImpl);
          if (pushRes.delivered) {
            await insertNotificationRow(db, msg, decision.tier, 'webpush', nowIso);
          }
        }
      }

      processed += 1;
    } catch {
      failed += 1;
    }
  }

  return { processed, failed, skippedInvalid, retryAfterSeconds: maxRetryAfter };
}

interface EscalationCandidateRow {
  id: string;
  workspace_id: string;
  item_id: string;
  type: AlertType;
  confidence: AlertConfidence;
  reason: string;
  created_at: string;
  reminded_at: string | null;
}

/**
 * Sends at most 1 escalation reminder for unclaimed High Live Moments or Breakout/Viral alerts.
 */
export async function processUnclaimedEscalations(
  db: D1Database,
  env: NotifyEnv,
  nowIso: string = new Date().toISOString(),
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const candidates = await db
    .prepare(
      `SELECT a.id, a.workspace_id, a.item_id, a.type, a.confidence, a.reason, a.created_at, a.reminded_at
       FROM alerts a
       WHERE a.reminded_at IS NULL
         AND ((a.type = 'live_moment' AND a.confidence = 'high') OR a.type IN ('breakout', 'viral'))
         AND NOT EXISTS (
           SELECT 1 FROM claims c
           WHERE c.workspace_id = a.workspace_id AND c.item_id = a.item_id AND c.status IN ('Claimed', 'Clipped')
         )
       LIMIT 25`,
    )
    .all<EscalationCandidateRow>();

  let escalated = 0;
  for (const row of candidates.results ?? []) {
    const decision = shouldEscalateUnclaimed({
      type: row.type,
      confidence: row.confidence,
      createdAt: row.created_at,
      now: nowIso,
      isClaimed: false,
      remindedAt: row.reminded_at,
    });
    if (!decision.shouldEscalate) continue;

    const updateRes = await db
      .prepare('UPDATE alerts SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL')
      .bind(nowIso, row.id)
      .run();
    if ((updateRes.meta?.changes ?? 0) === 0) continue;

    const webhookUrl = await resolveWorkspaceDiscordUrl(db, env, row.workspace_id);
    if (webhookUrl) {
      await sendDiscordWebhook(
        webhookUrl,
        {
          type: 'dispatch_alert',
          idempotencyKey: `escalation:${row.id}`,
          workspaceId: row.workspace_id,
          userId: 'team',
          alertId: row.id,
          alertType: row.type,
          confidence: row.confidence,
          title: `Unclaimed ${row.type} alert`,
          body: row.reason,
          isEscalation: true,
          createdAt: nowIso,
        },
        fetchImpl,
      );
    }
    escalated += 1;
  }
  return escalated;
}
