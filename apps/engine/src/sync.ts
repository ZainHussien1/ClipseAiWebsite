import {
  evaluateRising,
  resolveYouTubeChannelPublic,
  TokenBucketQuotaGovernor,
  YouTubeProvider,
  YouTubePublicProvider,
  type IngestQueueMessage,
  type Platform,
  type ProviderItem,
  type ProviderItemStats,
  type RisingBaselineSample,
} from '@clipse/core';
import { processIngestBatch } from './ingest.js';
import type { FetchLike } from '@clipse/core';

export interface SyncEnv {
  readonly DB: D1Database;
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
      },
    });
  }

  for (const stat of stats) {
    messages.push({
      type: 'record_stats',
      idempotencyKey: `sync-stat:youtube:${stat.externalId}:${stat.capturedAt}`,
      source: 'reconcile',
      receivedAt: nowIso,
      stats: {
        platform: 'youtube',
        externalId: stat.externalId,
        capturedAt: stat.capturedAt,
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
    await evaluateAndRecordRisingAlerts(db, channelId, externalId, items, stats, nowIso);
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

async function evaluateAndRecordRisingAlerts(
  db: D1Database,
  channelId: string,
  originalExternalId: string,
  items: readonly ProviderItem[],
  stats: readonly ProviderItemStats[],
  nowIso: string,
): Promise<void> {
  if (items.length === 0 || stats.length === 0) return;

  const followers = await db
    .prepare(
      `SELECT DISTINCT f.workspace_id
       FROM follows f
       INNER JOIN platform_accounts a ON a.id = f.account_id
       WHERE a.platform = 'youtube' AND (a.external_id = ? OR a.external_id = ?)`,
    )
    .bind(channelId, originalExternalId)
    .all<{ workspace_id: string }>();

  const workspaceIds = (followers.results ?? []).map((r) => r.workspace_id);
  if (workspaceIds.length === 0) return;

  const nowMs = Date.parse(nowIso);
  const sevenDaysAgoIso = new Date(nowMs - 7 * 86_400_000).toISOString();
  const baselineRes = await db
    .prepare(
      `SELECT i.published_at, s.views, s.likes, s.comments
       FROM items i
       INNER JOIN platform_accounts a ON a.id = i.account_id
       INNER JOIN item_stats s ON s.item_id = i.id
       WHERE a.platform = 'youtube'
         AND a.external_id = ?
         AND i.published_at < ?
       ORDER BY i.published_at DESC
       LIMIT 20`,
    )
    .bind(channelId, sevenDaysAgoIso)
    .all<{
      published_at: string;
      views: number;
      likes: number | null;
      comments: number | null;
    }>();

  const baselineRows = baselineRes.results ?? [];
  if (baselineRows.length < 5) {
    // F-01: Do not fire Rising alerts until >=5 historical (>7d) baseline items exist
    return;
  }

  const baseline: RisingBaselineSample[] = baselineRows.map((r) => {
    const itemAgeHours = Math.max(1, (nowMs - Date.parse(r.published_at)) / 3_600_000);
    const hasEng = r.likes !== null || r.comments !== null;
    return {
      viewsPerHour: r.views / itemAgeHours,
      engagementRate:
        hasEng && r.views > 0
          ? ((r.likes ?? 0) + (r.comments ?? 0)) / r.views
          : null,
    };
  });

  const statsByExternalId = new Map(stats.map((s) => [s.externalId, s]));

  for (const item of items) {
    const stat = statsByExternalId.get(item.externalId);
    if (!stat) continue;
    const ageHours = Math.max(0.25, (nowMs - Date.parse(item.publishedAt)) / 3_600_000);
    if (ageHours > 72) continue;

    const evalResult = evaluateRising({
      ageHours,
      views: stat.views,
      likes: stat.likes ?? null,
      comments: stat.comments ?? null,
      creatorBaseline: baseline,
    });

    if (evalResult.tier === 'none') continue;

    const itemId = `item:youtube:${item.externalId}`;
    for (const workspaceId of workspaceIds) {
      const alertId = `alert:${workspaceId}:${itemId}:${evalResult.tier}`;
      const existing = await db
        .prepare('SELECT id FROM alerts WHERE workspace_id = ? AND item_id = ? AND type = ? LIMIT 1')
        .bind(workspaceId, itemId, evalResult.tier)
        .first<{ id: string }>();
      if (existing) continue;

      const confidence =
        evalResult.tier === 'viral' ? 'high' : evalResult.tier === 'breakout' ? 'medium' : 'low';
      await db
        .prepare(
          `INSERT INTO alerts (id, workspace_id, item_id, type, confidence, score, reason, evidence_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          alertId,
          workspaceId,
          itemId,
          evalResult.tier,
          confidence,
          evalResult.score,
          evalResult.reason,
          JSON.stringify({
            velocityRatio: evalResult.velocityRatio,
            engagementRatio: evalResult.engagementRatio,
            usedColdStart: evalResult.usedColdStart,
          }),
          nowIso,
        )
        .run();

      await db
        .prepare(
          `INSERT INTO alert_deliveries (id, workspace_id, alert_id, channel, status, reason, attempted_at)
           VALUES (?, ?, ?, 'in_app', 'recorded', ?, ?)`,
        )
        .bind(`deliv:${alertId}`, workspaceId, alertId, evalResult.reason, nowIso)
        .run();
    }
  }
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
    if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
      return {
        ok: true,
        status: 'credentials_missing',
        itemsSynced: 0,
        message: 'Twitch API credentials (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET) are not configured',
      };
    }
    return {
      ok: true,
      status: 'synced',
      itemsSynced: 0,
      resolvedExternalId: input.externalId,
      message: 'Twitch sync requires an app access token exchange via EventSub/Helix',
    };
  }

  if (!env.KICK_CLIENT_ID || !env.KICK_CLIENT_SECRET) {
    return {
      ok: true,
      status: 'credentials_missing',
      itemsSynced: 0,
      message: 'Kick API credentials (KICK_CLIENT_ID / KICK_CLIENT_SECRET) are not configured',
    };
  }

  return {
    ok: true,
    status: 'synced',
    itemsSynced: 0,
    resolvedExternalId: input.externalId,
    message: 'Kick sync requires an OAuth 2.1 access token exchange',
  };
}
