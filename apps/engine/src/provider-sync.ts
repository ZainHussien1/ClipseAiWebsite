import {
  exchangeKickAppToken,
  exchangeTwitchAppToken,
  fetchKickPublicKey,
  KickProvider,
  TokenBucketQuotaGovernor,
  TwitchProvider,
  YouTubeProvider,
  YouTubePublicProvider,
  type FetchLike,
  type IngestQueueMessage,
  type Platform,
} from '@clipse/core';
import { processIngestBatch } from './ingest.js';
import type { SyncAccountResult, SyncDependencies, SyncEnv } from './sync.js';

export interface ProviderVerifyResult {
  readonly ok: boolean;
  readonly platform: Platform;
  readonly status: 'healthy' | 'not_configured' | 'failing';
  readonly mode: string;
  readonly message: string;
  readonly checkedAt: string;
}

export async function syncTwitchAccount(
  db: D1Database,
  env: SyncEnv,
  externalId: string,
  deps: SyncDependencies,
): Promise<SyncAccountResult> {
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return {
      ok: true,
      status: 'credentials_missing',
      itemsSynced: 0,
      message: 'Twitch API credentials (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET) are not configured',
    };
  }

  const nowIso = deps.nowIso ?? new Date().toISOString();
  const token = await exchangeTwitchAppToken(
    env.TWITCH_CLIENT_ID,
    env.TWITCH_CLIENT_SECRET,
    deps.fetchFn,
  );
  const twitch = new TwitchProvider({
    clientId: env.TWITCH_CLIENT_ID,
    appAccessToken: token.accessToken,
    fetchFn: deps.fetchFn,
    quota: deps.quota,
  });

  const channel = await twitch.fetchChannel(externalId);
  if (!channel) {
    return {
      ok: true,
      status: 'synced',
      itemsSynced: 0,
      resolvedExternalId: externalId,
      message: `Twitch channel ${externalId} not found`,
    };
  }

  const existingCount = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM items i
       INNER JOIN platform_accounts a ON a.id = i.account_id
       WHERE a.platform = 'twitch' AND a.external_id = ?`,
    )
    .bind(channel.externalId)
    .first<{ cnt: number }>();
  const isInitialBackfill = (existingCount?.cnt ?? 0) === 0;

  const [items, liveStatuses] = await Promise.all([
    twitch.fetchRecentItems(channel.externalId),
    twitch.fetchLiveStatus([channel.externalId]),
  ]);

  const messages: IngestQueueMessage[] = [];
  for (const item of items) {
    messages.push({
      type: 'upsert_item',
      idempotencyKey: `sync:twitch:${item.externalId}:${nowIso}`,
      source: 'reconcile',
      receivedAt: nowIso,
      account: {
        platform: 'twitch',
        externalId: channel.externalId,
        handle: channel.handle,
        displayName: channel.displayName,
        avatarUrl: channel.avatarUrl,
      },
      item: {
        platform: 'twitch',
        externalId: item.externalId,
        accountExternalId: channel.externalId,
        kind: item.kind,
        title: item.title,
        url: item.url,
        thumbnailUrl: item.thumbnailUrl,
        publishedAt: item.publishedAt,
        isBackfill: isInitialBackfill,
      },
    });
  }

  const live = liveStatuses[0];
  if (live?.isLive && live.streamExternalId) {
    const startedAt = live.startedAt ?? new Date(Date.parse(nowIso) - 15 * 60_000).toISOString();
    const clips = await twitch.fetchClipsSince(channel.externalId, startedAt);
    messages.push({
      type: 'record_live_sample',
      idempotencyKey: `sync-live:twitch:${live.streamExternalId}:${nowIso}`,
      source: 'reconcile',
      receivedAt: nowIso,
      account: {
        platform: 'twitch',
        externalId: channel.externalId,
        handle: channel.handle,
        displayName: channel.displayName,
        avatarUrl: channel.avatarUrl,
      },
      sample: {
        platform: 'twitch',
        streamExternalId: live.streamExternalId,
        accountExternalId: channel.externalId,
        title: live.title,
        sampledAt: nowIso,
        viewers: live.viewers ?? 0,
        isLive: true,
      },
    });
    for (const clip of clips) {
      messages.push({
        type: 'upsert_item',
        idempotencyKey: `sync-clip:twitch:${clip.id}:${nowIso}`,
        source: 'reconcile',
        receivedAt: nowIso,
        item: {
          platform: 'twitch',
          externalId: clip.id,
          accountExternalId: channel.externalId,
          kind: 'clip',
          title: clip.title,
          url: clip.url,
          publishedAt: clip.createdAt,
          durationSec: Math.round(clip.durationSec),
          isBackfill: isInitialBackfill,
        },
      });
    }
  }

  if (messages.length > 0) {
    await processIngestBatch(db, messages);
  } else {
    await db
      .prepare(
        `INSERT INTO platform_accounts (id, platform, external_id, handle, display_name, avatar_url, last_synced_at, updated_at)
         VALUES (?, 'twitch', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(platform, external_id) DO UPDATE SET
           handle = excluded.handle,
           display_name = excluded.display_name,
           avatar_url = COALESCE(excluded.avatar_url, platform_accounts.avatar_url),
           last_synced_at = excluded.last_synced_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        `acct:twitch:${channel.externalId}`,
        channel.externalId,
        channel.handle,
        channel.displayName,
        channel.avatarUrl ?? null,
        nowIso,
        nowIso,
      )
      .run();
  }

  return {
    ok: true,
    status: 'synced',
    itemsSynced: items.length,
    channelName: channel.displayName,
    resolvedExternalId: channel.externalId,
    message: `Synced ${items.length} Twitch items for ${channel.displayName}`,
  };
}

export async function syncKickAccount(
  db: D1Database,
  env: SyncEnv,
  externalId: string,
  deps: SyncDependencies,
): Promise<SyncAccountResult> {
  if (!env.KICK_CLIENT_ID || !env.KICK_CLIENT_SECRET) {
    return {
      ok: true,
      status: 'credentials_missing',
      itemsSynced: 0,
      message: 'Kick API credentials (KICK_CLIENT_ID / KICK_CLIENT_SECRET) are not configured',
    };
  }

  const nowIso = deps.nowIso ?? new Date().toISOString();
  const token = await exchangeKickAppToken(
    env.KICK_CLIENT_ID,
    env.KICK_CLIENT_SECRET,
    deps.fetchFn,
  );
  const kick = new KickProvider({
    accessToken: token.accessToken,
    fetchFn: deps.fetchFn,
    quota: deps.quota,
  });

  const channel = await kick.fetchChannel(externalId);
  if (!channel) {
    return {
      ok: true,
      status: 'synced',
      itemsSynced: 0,
      resolvedExternalId: externalId,
      message: `Kick channel ${externalId} not found`,
    };
  }

  const liveStatuses = await kick.fetchLiveStatus([channel.externalId]);
  const live = liveStatuses[0];
  let itemsSynced = 0;

  if (live?.isLive && live.streamExternalId) {
    await processIngestBatch(db, [
      {
        type: 'record_live_sample',
        idempotencyKey: `sync-live:kick:${live.streamExternalId}:${nowIso}`,
        source: 'reconcile',
        receivedAt: nowIso,
        account: {
          platform: 'kick',
          externalId: channel.externalId,
          handle: channel.handle,
          displayName: channel.displayName,
        },
        sample: {
          platform: 'kick',
          streamExternalId: live.streamExternalId,
          accountExternalId: channel.externalId,
          title: live.title,
          sampledAt: nowIso,
          viewers: live.viewers ?? 0,
          isLive: true,
        },
      },
    ]);
    itemsSynced = 1;
  } else {
    await db
      .prepare(
        `INSERT INTO platform_accounts (id, platform, external_id, handle, display_name, last_synced_at, updated_at)
         VALUES (?, 'kick', ?, ?, ?, ?, ?)
         ON CONFLICT(platform, external_id) DO UPDATE SET
           handle = excluded.handle,
           display_name = excluded.display_name,
           last_synced_at = excluded.last_synced_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        `acct:kick:${channel.externalId}`,
        channel.externalId,
        channel.handle,
        channel.displayName,
        nowIso,
        nowIso,
      )
      .run();
  }

  return {
    ok: true,
    status: 'synced',
    itemsSynced,
    channelName: channel.displayName,
    resolvedExternalId: channel.externalId,
    message: live?.isLive
      ? `Kick channel ${channel.displayName} is live (${live.viewers ?? 0} viewers)`
      : `Kick channel ${channel.displayName} synced (offline)`,
  };
}

export async function verifyProviderCredentials(
  env: SyncEnv,
  platform: Platform,
  deps: { fetchFn?: FetchLike; quota?: TokenBucketQuotaGovernor; nowIso?: string } = {},
): Promise<ProviderVerifyResult> {
  const checkedAt = deps.nowIso ?? new Date().toISOString();

  if (platform === 'youtube') {
    try {
      if (env.YOUTUBE_API_KEY) {
        const yt = new YouTubeProvider({
          apiKey: env.YOUTUBE_API_KEY,
          fetchFn: deps.fetchFn,
          quota: deps.quota,
        });
        const ch = await yt.fetchChannel('UC_x5XG1OV2P6uZZ5FSM9Ttw');
        return {
          ok: Boolean(ch),
          platform,
          status: ch ? 'healthy' : 'failing',
          mode: 'api_key',
          message: ch ? 'YouTube Data API v3 reachable' : 'YouTube channel lookup returned empty',
          checkedAt,
        };
      }
      const pub = new YouTubePublicProvider(deps.fetchFn);
      await pub.fetchFeedByChannelId('UC_x5XG1OV2P6uZZ5FSM9Ttw');
      return {
        ok: true,
        platform,
        status: 'healthy',
        mode: 'public_feed',
        message: 'YouTube public Atom feed reachable',
        checkedAt,
      };
    } catch (err) {
      return {
        ok: false,
        platform,
        status: 'failing',
        mode: env.YOUTUBE_API_KEY ? 'api_key' : 'public_feed',
        message: err instanceof Error ? err.message : 'YouTube verification failed',
        checkedAt,
      };
    }
  }

  if (platform === 'twitch') {
    if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
      return {
        ok: false,
        platform,
        status: 'not_configured',
        mode: 'unconfigured',
        message: 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set',
        checkedAt,
      };
    }
    try {
      await exchangeTwitchAppToken(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET, deps.fetchFn);
      return {
        ok: true,
        platform,
        status: 'healthy',
        mode: 'oauth_app_token',
        message: 'Twitch OAuth app token verified',
        checkedAt,
      };
    } catch (err) {
      return {
        ok: false,
        platform,
        status: 'failing',
        mode: 'oauth_app_token',
        message: err instanceof Error ? err.message : 'Twitch verification failed',
        checkedAt,
      };
    }
  }

  if (!env.KICK_CLIENT_ID || !env.KICK_CLIENT_SECRET) {
    return {
      ok: false,
      platform,
      status: 'not_configured',
      mode: 'unconfigured',
      message: 'KICK_CLIENT_ID / KICK_CLIENT_SECRET not set',
      checkedAt,
    };
  }
  try {
    await exchangeKickAppToken(env.KICK_CLIENT_ID, env.KICK_CLIENT_SECRET, deps.fetchFn);
    await fetchKickPublicKey(deps.fetchFn);
    return {
      ok: true,
      platform,
      status: 'healthy',
      mode: 'oauth_app_token',
      message: 'Kick OAuth token and webhook public key verified',
      checkedAt,
    };
  } catch (err) {
    return {
      ok: false,
      platform,
      status: 'failing',
      mode: 'oauth_app_token',
      message: err instanceof Error ? err.message : 'Kick verification failed',
      checkedAt,
    };
  }
}
