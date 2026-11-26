import { describe, expect, it } from 'vitest';
import {
  AppError,
  TokenBucketQuotaGovernor,
  type IngestQueueMessage,
  type Provider,
} from '@clipse/core';
import { processIngestBatch } from './ingest.js';
import { reconcilePlatformAccounts } from './reconciler.js';

interface StoredItem {
  id: string;
  platform: string;
  external_id: string;
  title: string;
  first_seen_at: string;
  raw_refreshed_at: string;
}

function createEngineMockDb() {
  const accounts = new Map<string, { id: string; platform: string; external_id: string }>();
  const items = new Map<string, StoredItem>();
  const metrics = new Map<string, { pushes: number; missed: number; runs: number }>();

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM platform_accounts')) {
                const key = `${String(args[0])}:${String(args[1])}`;
                const found = accounts.get(key);
                return (found ? { id: found.id } : null) as T | null;
              }
              if (sql.includes('FROM items')) {
                const key = `${String(args[0])}:${String(args[1])}`;
                const found = items.get(key);
                return (found ? { id: found.id } : null) as T | null;
              }
              return null;
            },
            async run() {
              if (sql.includes('INSERT INTO platform_accounts')) {
                const id = String(args[0]);
                const platform = String(args[1]);
                const external_id = String(args[2]);
                const key = `${platform}:${external_id}`;
                if (!accounts.has(key)) {
                  accounts.set(key, { id, platform, external_id });
                }
              } else if (sql.includes('INSERT INTO items')) {
                const id = String(args[0]);
                const platform = String(args[2]);
                const external_id = String(args[3]);
                const title = String(args[5]);
                const first_seen_at = String(args[9]);
                const raw_refreshed_at = String(args[10]);
                const key = `${platform}:${external_id}`;
                const existing = items.get(key);
                if (!existing) {
                  items.set(key, {
                    id,
                    platform,
                    external_id,
                    title,
                    first_seen_at,
                    raw_refreshed_at,
                  });
                } else if (raw_refreshed_at >= existing.raw_refreshed_at) {
                  existing.title = title;
                  existing.raw_refreshed_at = raw_refreshed_at;
                }
              } else if (sql.includes('INSERT INTO ingestion_metrics')) {
                const platform = String(args[1]);
                const date = String(args[2]);
                const key = `${platform}:${date}`;
                const cur = metrics.get(key) ?? { pushes: 0, missed: 0, runs: 0 };
                if (sql.includes('pushes_received, missed_pushes, reconcile_runs, updated_at)\n       VALUES (?, ?, ?, 1, 0, 0')) {
                  cur.pushes += 1;
                } else {
                  cur.missed += Number(args[3] ?? 0);
                  cur.runs += 1;
                }
                metrics.set(key, cur);
              }
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, items, metrics };
}

describe('engine ingest consumer and reconciler', () => {
  it('upserts idempotently, preserves first_seen_at, and ignores out-of-order stale updates', async () => {
    const { db, items } = createEngineMockDb();

    const newerMsg: IngestQueueMessage = {
      type: 'upsert_item',
      idempotencyKey: 'yt:v1:t2',
      source: 'webhook',
      receivedAt: '2026-11-26T10:05:00Z',
      item: {
        platform: 'youtube',
        externalId: 'vid-1',
        accountExternalId: 'UC123',
        kind: 'video',
        title: 'Updated Title',
        url: 'https://www.youtube.com/watch?v=vid-1',
        publishedAt: '2026-11-26T10:00:00Z',
        isEdit: true,
      },
    };

    const olderMsg: IngestQueueMessage = {
      type: 'upsert_item',
      idempotencyKey: 'yt:v1:t1',
      source: 'webhook',
      receivedAt: '2026-11-26T10:01:00Z',
      item: {
        platform: 'youtube',
        externalId: 'vid-1',
        accountExternalId: 'UC123',
        kind: 'video',
        title: 'Stale Original Title',
        url: 'https://www.youtube.com/watch?v=vid-1',
        publishedAt: '2026-11-26T10:00:00Z',
      },
    };

    const res1 = await processIngestBatch(db, [newerMsg]);
    expect(res1).toEqual({ processed: 1, failed: 0, skippedInvalid: 0 });

    const res2 = await processIngestBatch(db, [olderMsg]);
    expect(res2).toEqual({ processed: 1, failed: 0, skippedInvalid: 0 });

    expect(items.size).toBe(1);
    const stored = items.get('youtube:vid-1');
    expect(stored?.first_seen_at).toBe('2026-11-26T10:05:00Z');
    expect(stored?.title).toBe('Updated Title');
  });

  it('reconciler counts missed pushes and degrades gracefully on 429 circuit breaker', async () => {
    const { db, items, metrics } = createEngineMockDb();
    const quota = new TokenBucketQuotaGovernor();

    const provider: Provider = {
      platform: 'youtube',
      async fetchChannel() {
        return null;
      },
      async fetchRecentItems() {
        return [
          {
            platform: 'youtube',
            externalId: 'missed-vid-1',
            accountExternalId: 'UC123',
            kind: 'video',
            title: 'Missed Push Video',
            url: 'https://www.youtube.com/watch?v=missed-vid-1',
            publishedAt: '2026-11-26T10:00:00Z',
          },
        ];
      },
      async fetchStatsBatch() {
        return [];
      },
      async fetchLiveStatus() {
        return [];
      },
    };

    const result = await reconcilePlatformAccounts(
      db,
      provider,
      [{ externalId: 'UC123', starred: true }],
      quota,
      { nowIso: '2026-11-26T11:00:00Z', randomFn: () => 0.5 },
    );

    expect(result.missedPushes).toBe(1);
    expect(result.skippedDegraded).toBe(false);
    expect(items.has('youtube:missed-vid-1')).toBe(true);
    expect(metrics.get('youtube:2026-11-26')?.missed).toBe(1);

    // Simulate 429 circuit breaker
    const rateLimitedProvider: Provider = {
      ...provider,
      async fetchRecentItems() {
        quota.recordRateLimit('youtube', 120);
        throw AppError.rateLimited('429');
      },
    };

    const degraded = await reconcilePlatformAccounts(
      db,
      rateLimitedProvider,
      [{ externalId: 'UC123', starred: false }],
      quota,
      { nowIso: '2026-11-26T11:05:00Z' },
    );
    expect(degraded.skippedDegraded).toBe(true);
  });
});
