import {
  resolveYouTubeChannelPublic,
  TokenBucketQuotaGovernor,
  YouTubeProvider,
  YouTubePublicProvider,
  type IngestQueueMessage,
  type Platform,
  type ProviderItem,
  type ProviderItemStats,
} from '@clipse/core';
import { processIngestBatch } from './ingest.js';
import { syncKickAccount, syncTwitchAccount } from './provider-sync.js';
import { evaluateAndDispatchRisingAlerts } from './rising-pipeline.js';
import type { FetchLike } from '@clipse/core';

export interface SyncEnv {
  readonly DB: D1Database;
  readonly ENVIRONMENT?: string;
  readonly NOTIFY_QUEUE?: Queue;
  readonly WEBHOOK_ENCRYPTION_KEY?: string;
  readonly DISCORD_WEBHOOK_URL?: string;
  readonly VAPID_PUBLIC_KEY?: string;
  readonly VAPID_PRIVATE_KEY?: string;
  readonly VAPID_SUBJECT?: string;
  readonly YOUTUBE_API_KEY?: string;
  readonly TWITCH_CLIENT_ID?: string;
  readonly TWITCH_CLIENT_SECRET?: string;
  readonly KICK_CLIENT_ID?: string;
  readonly KICK_CLIENT_SECRET?: string;
}

export interface SyncAccountInput {
  readonly platform: Platform;
  readonly externalId: string;
}

export interface SyncAccountResult {
  readonly ok: true;
  readonly status: 'synced' | 'credentials_missing';
  readonly itemsSynced: number;
  readonly channelName?: string;
  readonly resolvedExternalId?: string;
  readonly message: string;
}

export interface SyncDependencies {
  readonly fetchFn?: FetchLike;
  readonly quota?: TokenBucketQuotaGovernor;
  readonly nowIso?: string;
}

async function syncYouTubeAccount(
  db: D1Database,
  env: SyncEnv,
  externalId: string,
  deps: SyncDependencies,
): Promise<SyncAccountResult> {
  const nowIso = deps.nowIso ?? new Date().toISOString();
  const fetchFn = deps.fetchFn;
  let channelId = externalId;
  let channelName = externalId;
  let handle = externalId.startsWith('@') ? externalId.toLowerCase() : externalId;
  let avatarUrl: string | undefined;
  let items: readonly ProviderItem[] = [];
  let stats: readonly ProviderItemStats[] = [];

  if (env.YOUTUBE_API_KEY) {
    const yt = new YouTubeProvider({
      apiKey: env.YOUTUBE_API_KEY,
      fetchFn,
      quota: deps.quota,
    });
    const channel = await yt.fetchChannel(externalId);
    if (channel) {
      channelId = channel.externalId;
      channelName = channel.displayName;
      handle = channel.handle;
      avatarUrl = channel.avatarUrl;
    }
    items = await yt.fetchRecentItems(channelId);
    if (items.length > 0) {
      stats = await yt.fetchStatsBatch(items.map((i) => i.externalId));
    }
  } else {
    const pub = new YouTubePublicProvider(fetchFn);
    const resolved = await resolveYouTubeChannelPublic(externalId, fetchFn);
    if (!resolved) {
      return {
        ok: true,
        status: 'synced',
        itemsSynced: 0,
        resolvedExternalId: externalId,
        message: `Could not resolve YouTube channel ${externalId}`,
      };
    }
    channelId = resolved.channelId;
    const feed = await pub.fetchFeedByChannelId(channelId);
    channelName = resolved.channelTitle ?? feed.channelTitle ?? channelId;
    items = feed.items;
    stats = feed.stats;
  }

  const existingCountRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM items i
       INNER JOIN platform_accounts a ON a.id = i.account_id
       WHERE a.platform = 'youtube' AND a.external_id = ?`,
    )
    .bind(channelId)
    .first<{ cnt: number }>();
  const isInitialBackfill = (existingCountRow?.cnt ?? 0) === 0;

  const messages: IngestQueueMessage[] = [];
  for (const item of items) {
    messages.push({
      type: 'upsert_item',
      idempotencyKey: `sync:${item.platform}:${item.externalId}:${nowIso}`,
      source: 'reconcile',
      receivedAt: nowIso,
      account: {
        platform: 'youtube',
        externalId: channelId,
        handle,
        displayName: channelName,
        avatarUrl,
      },
      item: {
        platform: 'youtube',
        externalId: item.externalId,
        accountExternalId: channelId,
        kind: item.kind,
        title: item.title,
        url: item.url,
        thumbnailUrl: item.thumbnailUrl,
        publishedAt: item.publishedAt,
        isBackfill: isInitialBackfill,
        durationSec: item.durationSec,
        shortsClassification:
          item.shortsClassification ??
          (item.kind === 'short'
            ? 'short'
            : item.kind === 'live'
              ? 'live'
              : env.YOUTUBE_API_KEY
                ? 'video'
                : 'unclassified'),
      },
    });
  }

  for (const stat of stats) {
    const capturedAt = deps.nowIso ?? stat.capturedAt;
    messages.push({
      type: 'record_stats',
      idempotencyKey: `sync-stat:youtube:${stat.externalId}:${capturedAt}`,
      source: 'reconcile',
      receivedAt: nowIso,
      stats: {
        platform: 'youtube',
        externalId: stat.externalId,
        capturedAt,
        views: stat.views,
        likes: stat.likes,
        comments: stat.comments,
      },
    });
  }

  if (messages.length > 0) {
    await processIngestBatch(db, messages);
  } else {
    await db
      .prepare(
        `INSERT INTO platform_accounts (id, platform, external_id, handle, display_name, avatar_url, last_synced_at, updated_at)
         VALUES (?, 'youtube', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(platform, external_id) DO UPDATE SET
           handle = excluded.handle,
           display_name = excluded.display_name,
           avatar_url = COALESCE(excluded.avatar_url, platform_accounts.avatar_url),
           last_synced_at = excluded.last_synced_at,
           updated_at = excluded.updated_at`,
      )
      .bind(`acct:youtube:${channelId}`, channelId, handle, channelName, avatarUrl ?? null, nowIso, nowIso)
      .run();
  }

  if (!isInitialBackfill) {
    await evaluateAndDispatchRisingAlerts(
      db,
      { ...env, ENVIRONMENT: env.ENVIRONMENT ?? 'local' },
      channelId,
      externalId,
      items,
      nowIso,
    );
  }

  return {
    ok: true,
    status: 'synced',
    itemsSynced: items.length,
    channelName,
    resolvedExternalId: channelId,
    message: `Synced ${items.length} YouTube items for ${channelName}`,
  };
}

export async function syncPlatformAccount(
  db: D1Database,
  env: SyncEnv,
  input: SyncAccountInput,
  deps: SyncDependencies = {},
): Promise<SyncAccountResult> {
  if (input.platform === 'youtube') {
    return syncYouTubeAccount(db, env, input.externalId, deps);
  }
  if (input.platform === 'twitch') {
    return syncTwitchAccount(db, env, input.externalId, deps);
  }
  return syncKickAccount(db, env, input.externalId, deps);
}
