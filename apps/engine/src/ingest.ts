import {
  ingestQueueMessageSchema,
  type IngestQueueMessage,
  type Platform,
} from '@clipse/core';

export interface IngestBatchResult {
  readonly processed: number;
  readonly failed: number;
  readonly skippedInvalid: number;
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}:${parts.join(':')}`;
}

async function upsertAccount(
  db: D1Database,
  platform: Platform,
  externalId: string,
  handle: string,
  displayName: string,
  syncedAt: string,
  avatarUrl?: string,
): Promise<string> {
  const id = deterministicId('acct', platform, externalId);
  await db
    .prepare(
      `INSERT INTO platform_accounts (id, platform, external_id, handle, display_name, avatar_url, last_synced_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, external_id) DO UPDATE SET
         handle = excluded.handle,
         display_name = excluded.display_name,
         avatar_url = COALESCE(excluded.avatar_url, platform_accounts.avatar_url),
         last_synced_at = excluded.last_synced_at,
         updated_at = excluded.updated_at`,
    )
    .bind(id, platform, externalId, handle, displayName, avatarUrl ?? null, syncedAt, syncedAt)
    .run();

  const row = await db
    .prepare('SELECT id FROM platform_accounts WHERE platform = ? AND external_id = ? LIMIT 1')
    .bind(platform, externalId)
    .first<{ id: string }>();

  return row?.id ?? id;
}

async function ensureAccountId(
  db: D1Database,
  platform: Platform,
  accountExternalId: string,
  syncedAt: string,
): Promise<string> {
  const existing = await db
    .prepare('SELECT id FROM platform_accounts WHERE platform = ? AND external_id = ? LIMIT 1')
    .bind(platform, accountExternalId)
    .first<{ id: string }>();
  if (existing) return existing.id;

  return upsertAccount(
    db,
    platform,
    accountExternalId,
    accountExternalId,
    accountExternalId,
    syncedAt,
  );
}

async function upsertItem(
  db: D1Database,
  accountId: string,
  msg: Extract<IngestQueueMessage, { type: 'upsert_item' }>,
): Promise<void> {
  const { item, receivedAt } = msg;
  const itemId = deterministicId('item', item.platform, item.externalId);

  await db
    .prepare(
      `INSERT INTO items (id, account_id, platform, external_id, kind, title, url, thumbnail_url, published_at, first_seen_at, raw_refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, external_id) DO UPDATE SET
         kind = CASE WHEN excluded.raw_refreshed_at >= items.raw_refreshed_at THEN excluded.kind ELSE items.kind END,
         title = CASE WHEN excluded.raw_refreshed_at >= items.raw_refreshed_at THEN excluded.title ELSE items.title END,
         url = CASE WHEN excluded.raw_refreshed_at >= items.raw_refreshed_at THEN excluded.url ELSE items.url END,
         thumbnail_url = COALESCE(excluded.thumbnail_url, items.thumbnail_url),
         raw_refreshed_at = CASE WHEN excluded.raw_refreshed_at >= items.raw_refreshed_at THEN excluded.raw_refreshed_at ELSE items.raw_refreshed_at END`,
    )
    .bind(
      itemId,
      accountId,
      item.platform,
      item.externalId,
      item.kind,
      item.title,
      item.url,
      item.thumbnailUrl ?? null,
      item.publishedAt,
      receivedAt,
      receivedAt,
    )
    .run();
}

async function recordStats(
  db: D1Database,
  msg: Extract<IngestQueueMessage, { type: 'record_stats' }>,
): Promise<void> {
  const { stats } = msg;
  const itemRow = await db
    .prepare('SELECT id FROM items WHERE platform = ? AND external_id = ? LIMIT 1')
    .bind(stats.platform, stats.externalId)
    .first<{ id: string }>();
  if (!itemRow) return;

  const statId = deterministicId('stat', itemRow.id, stats.capturedAt);
  await db
    .prepare(
      `INSERT OR IGNORE INTO item_stats (id, item_id, captured_at, views, likes, comments)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      statId,
      itemRow.id,
      stats.capturedAt,
      stats.views,
      stats.likes ?? null,
      stats.comments ?? null,
    )
    .run();
}

async function recordLiveSample(
  db: D1Database,
  accountId: string,
  msg: Extract<IngestQueueMessage, { type: 'record_live_sample' }>,
): Promise<void> {
  const { sample, receivedAt } = msg;
  const itemId = deterministicId('item', sample.platform, sample.streamExternalId);
  const streamUrl =
    sample.platform === 'twitch'
      ? `https://www.twitch.tv/${sample.accountExternalId}`
      : sample.platform === 'kick'
        ? `https://kick.com/${sample.accountExternalId}`
        : `https://www.youtube.com/watch?v=${sample.streamExternalId}`;

  await db
    .prepare(
      `INSERT INTO items (id, account_id, platform, external_id, kind, title, url, published_at, first_seen_at, raw_refreshed_at)
       VALUES (?, ?, ?, ?, 'live', ?, ?, ?, ?, ?)
       ON CONFLICT(platform, external_id) DO UPDATE SET
         title = COALESCE(excluded.title, items.title),
         raw_refreshed_at = CASE WHEN excluded.raw_refreshed_at >= items.raw_refreshed_at THEN excluded.raw_refreshed_at ELSE items.raw_refreshed_at END`,
    )
    .bind(
      itemId,
      accountId,
      sample.platform,
      sample.streamExternalId,
      sample.title ?? 'Live Stream',
      streamUrl,
      sample.sampledAt,
      receivedAt,
      receivedAt,
    )
    .run();

  const sampleId = deterministicId('live', itemId, sample.sampledAt);
  await db
    .prepare(
      `INSERT OR IGNORE INTO live_samples (id, item_id, sampled_at, viewers, is_live)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(sampleId, itemId, sample.sampledAt, sample.viewers, sample.isLive ? 1 : 0)
    .run();
}

async function incrementPushMetric(
  db: D1Database,
  platform: Platform,
  receivedAt: string,
): Promise<void> {
  const metricDate = receivedAt.slice(0, 10);
  const metricId = deterministicId('metric', platform, metricDate);
  await db
    .prepare(
      `INSERT INTO ingestion_metrics (id, platform, metric_date, pushes_received, missed_pushes, reconcile_runs, updated_at)
       VALUES (?, ?, ?, 1, 0, 0, ?)
       ON CONFLICT(platform, metric_date) DO UPDATE SET
         pushes_received = ingestion_metrics.pushes_received + 1,
         updated_at = excluded.updated_at`,
    )
    .bind(metricId, platform, metricDate, receivedAt)
    .run();
}

export async function processIngestBatch(
  db: D1Database,
  rawMessages: readonly unknown[],
): Promise<IngestBatchResult> {
  let processed = 0;
  let failed = 0;
  let skippedInvalid = 0;

  for (const raw of rawMessages) {
    const parsed = ingestQueueMessageSchema.safeParse(raw);
    if (!parsed.success) {
      skippedInvalid++;
      continue;
    }

    const msg = parsed.data;
    try {
      if (msg.type === 'upsert_item') {
        const accountId = msg.account
          ? await upsertAccount(
              db,
              msg.account.platform,
              msg.account.externalId,
              msg.account.handle,
              msg.account.displayName,
              msg.receivedAt,
              msg.account.avatarUrl,
            )
          : await ensureAccountId(db, msg.item.platform, msg.item.accountExternalId, msg.receivedAt);

        await upsertItem(db, accountId, msg);
        if (msg.source === 'webhook') {
          await incrementPushMetric(db, msg.item.platform, msg.receivedAt);
        }
      } else if (msg.type === 'record_stats') {
        await recordStats(db, msg);
      } else {
        const accountId = msg.account
          ? await upsertAccount(
              db,
              msg.account.platform,
              msg.account.externalId,
              msg.account.handle,
              msg.account.displayName,
              msg.receivedAt,
              msg.account.avatarUrl,
            )
          : await ensureAccountId(
              db,
              msg.sample.platform,
              msg.sample.accountExternalId,
              msg.receivedAt,
            );
        await recordLiveSample(db, accountId, msg);
        if (msg.source === 'webhook') {
          await incrementPushMetric(db, msg.sample.platform, msg.receivedAt);
        }
      }
      processed++;
    } catch {
      failed++;
    }
  }

  return { processed, failed, skippedInvalid };
}
