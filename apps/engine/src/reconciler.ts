import {
  AppError,
  type IngestQueueMessage,
  type Platform,
  type Provider,
  type TokenBucketQuotaGovernor,
} from '@clipse/core';
import { processIngestBatch } from './ingest.js';

export interface ReconcileAccount {
  readonly externalId: string;
  readonly starred: boolean;
}

export interface ReconcileResult {
  readonly platform: Platform;
  readonly processedAccounts: number;
  readonly itemsSynced: number;
  readonly missedPushes: number;
  readonly skippedDegraded: boolean;
  readonly jitterMs: number;
}

export function computeJitterMs(baseMs: number, randomFn: () => number = Math.random): number {
  const spread = baseMs * 0.2;
  const delta = (randomFn() * 2 - 1) * spread;
  return Math.max(0, Math.round(baseMs + delta));
}

async function recordReconcileMetrics(
  db: D1Database,
  platform: Platform,
  missedPushes: number,
  nowIso: string,
): Promise<void> {
  const metricDate = nowIso.slice(0, 10);
  const metricId = `metric:${platform}:${metricDate}`;
  await db
    .prepare(
      `INSERT INTO ingestion_metrics (id, platform, metric_date, pushes_received, missed_pushes, reconcile_runs, updated_at)
       VALUES (?, ?, ?, 0, ?, 1, ?)
       ON CONFLICT(platform, metric_date) DO UPDATE SET
         missed_pushes = ingestion_metrics.missed_pushes + excluded.missed_pushes,
         reconcile_runs = ingestion_metrics.reconcile_runs + 1,
         updated_at = excluded.updated_at`,
    )
    .bind(metricId, platform, metricDate, missedPushes, nowIso)
    .run();
}

export async function reconcilePlatformAccounts(
  db: D1Database,
  provider: Provider,
  accounts: readonly ReconcileAccount[],
  quota: TokenBucketQuotaGovernor,
  options: { nowIso?: string; baseJitterMs?: number; randomFn?: () => number } = {},
): Promise<ReconcileResult> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const jitterMs = computeJitterMs(options.baseJitterMs ?? 1500, options.randomFn);

  if (quota.isDegraded(provider.platform) || accounts.length === 0) {
    return {
      platform: provider.platform,
      processedAccounts: 0,
      itemsSynced: 0,
      missedPushes: 0,
      skippedDegraded: quota.isDegraded(provider.platform),
      jitterMs,
    };
  }

  let itemsSynced = 0;
  let missedPushes = 0;
  let processedAccounts = 0;
  const queueMessages: IngestQueueMessage[] = [];

  try {
    for (const account of accounts) {
      if (quota.isDegraded(provider.platform)) {
        break;
      }
      const recent = await provider.fetchRecentItems(account.externalId);
      processedAccounts++;

      for (const item of recent) {
        const existing = await db
          .prepare('SELECT id FROM items WHERE platform = ? AND external_id = ? LIMIT 1')
          .bind(item.platform, item.externalId)
          .first<{ id: string }>();

        if (!existing) {
          missedPushes++;
        }

        queueMessages.push({
          type: 'upsert_item',
          idempotencyKey: `reconcile:${item.platform}:${item.externalId}:${nowIso}`,
          source: 'reconcile',
          receivedAt: nowIso,
          item: {
            platform: item.platform,
            externalId: item.externalId,
            accountExternalId: item.accountExternalId,
            kind: item.kind,
            title: item.title,
            url: item.url,
            thumbnailUrl: item.thumbnailUrl,
            publishedAt: item.publishedAt,
          },
        });
        itemsSynced++;
      }
    }

    const starredIds = accounts.filter((a) => a.starred).map((a) => a.externalId);
    if (starredIds.length > 0 && !quota.isDegraded(provider.platform)) {
      const liveStatuses = await provider.fetchLiveStatus(starredIds);
      for (const live of liveStatuses) {
        if (!live.isLive || !live.streamExternalId) continue;
        queueMessages.push({
          type: 'record_live_sample',
          idempotencyKey: `reconcile-live:${provider.platform}:${live.streamExternalId}:${nowIso}`,
          source: 'reconcile',
          receivedAt: nowIso,
          sample: {
            platform: provider.platform,
            streamExternalId: live.streamExternalId,
            accountExternalId: live.accountExternalId,
            title: live.title,
            sampledAt: nowIso,
            viewers: live.viewers ?? 0,
            isLive: true,
          },
        });
      }
    }
  } catch (err) {
    if (err instanceof AppError && err.code === 'RATE_LIMITED') {
      await recordReconcileMetrics(db, provider.platform, missedPushes, nowIso);
      return {
        platform: provider.platform,
        processedAccounts,
        itemsSynced,
        missedPushes,
        skippedDegraded: true,
        jitterMs,
      };
    }
    throw err;
  }

  if (queueMessages.length > 0) {
    await processIngestBatch(db, queueMessages);
  }
  await recordReconcileMetrics(db, provider.platform, missedPushes, nowIso);

  return {
    platform: provider.platform,
    processedAccounts,
    itemsSynced,
    missedPushes,
    skippedDegraded: false,
    jitterMs,
  };
}
