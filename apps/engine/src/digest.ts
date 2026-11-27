import {
  escapeDiscordMarkdown,
  validateDiscordWebhookUrl,
  type AlertDeliveryStatus,
  type NotifyDeliveryResult,
} from '@clipse/core';

export interface AlertDeliveryLogInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly alertId: string;
  readonly channel: string;
  readonly status: AlertDeliveryStatus;
  readonly reason: string | null;
  readonly attemptedAt: string;
  readonly deliveredAt?: string | null;
}

export async function recordAlertDelivery(
  db: D1Database,
  entry: AlertDeliveryLogInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO alert_deliveries
       (id, workspace_id, alert_id, channel, status, reason, attempted_at, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.id,
      entry.workspaceId,
      entry.alertId,
      entry.channel,
      entry.status,
      entry.reason,
      entry.attemptedAt,
      entry.deliveredAt ?? null,
    )
    .run();
}

export interface DigestAlertSummary {
  readonly creatorName: string;
  readonly title: string;
  readonly tierLabel: string;
  readonly reason: string;
  readonly url?: string | null;
}

export interface DiscordDailyDigestInput {
  readonly workspaceName: string;
  readonly dateLabel: string;
  readonly totalAlerts: number;
  readonly claimedCount: number;
  readonly clippedCount: number;
  readonly topItems: readonly DigestAlertSummary[];
  readonly dashboardUrl?: string;
}

/**
 * Formats a Discord daily digest embed with mention-injection escaping
 * and `allowed_mentions: { parse: [] }`.
 */
export function formatDiscordDailyDigestEmbed(
  input: DiscordDailyDigestInput,
): Record<string, unknown> {
  const safeWorkspace = escapeDiscordMarkdown(input.workspaceName);
  const safeDate = escapeDiscordMarkdown(input.dateLabel);
  const lines = input.topItems.slice(0, 8).map((item, idx) => {
    const creator = escapeDiscordMarkdown(item.creatorName);
    const title = escapeDiscordMarkdown(item.title).slice(0, 80);
    const tier = escapeDiscordMarkdown(item.tierLabel);
    const reason = escapeDiscordMarkdown(item.reason);
    const link =
      item.url && item.url.startsWith('https://') ? ` — [Open](${item.url})` : '';
    return `${idx + 1}. **[${tier}] ${creator}**: ${title} (${reason})${link}`;
  });

  const dashboardLink =
    input.dashboardUrl && input.dashboardUrl.startsWith('https://')
      ? `\n\n[Open Daily Report](${input.dashboardUrl})`
      : '';

  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `Clipse Radar Daily Digest — ${safeWorkspace} (${safeDate})`,
        description:
          (lines.length > 0 ? lines.join('\n') : 'No alerts recorded for this period.') +
          dashboardLink,
        color: 0x18b9cc,
        fields: [
          { name: 'Alerts', value: String(input.totalAlerts), inline: true },
          { name: 'Claimed', value: String(input.claimedCount), inline: true },
          { name: 'Clipped', value: String(input.clippedCount), inline: true },
        ],
      },
    ],
  };
}

function parseRetryAfterSeconds(headerValue: string | null): number {
  if (!headerValue) return 5;
  const parsed = Number(headerValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(300, Math.ceil(parsed)) : 5;
}

export async function sendDiscordDailyDigest(
  webhookUrl: string,
  input: DiscordDailyDigestInput,
  fetchImpl: typeof fetch = fetch,
): Promise<NotifyDeliveryResult> {
  const check = validateDiscordWebhookUrl(webhookUrl);
  if (!check.valid) {
    return { delivered: false, statusCode: 400 };
  }

  const response = await fetchImpl(check.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formatDiscordDailyDigestEmbed(input)),
    redirect: 'error',
  });

  if (response.status === 429) {
    return {
      delivered: false,
      statusCode: 429,
      retryAfterSeconds: parseRetryAfterSeconds(response.headers.get('Retry-After')),
    };
  }

  return { delivered: response.ok, statusCode: response.status };
}
