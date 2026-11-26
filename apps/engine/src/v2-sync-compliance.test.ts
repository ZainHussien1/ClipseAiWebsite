import { describe, expect, it } from 'vitest';
import { clearKickCaches, clearTwitchTokenCache } from '@clipse/core';
import { enforceYouTube30DayCompliance } from './compliance.js';
import { verifyProviderCredentials } from './provider-sync.js';
import { syncPlatformAccount } from './sync.js';

interface StoredItemRow {
  id: string;
  platform: string;
  external_id: string;
  kind: string;
  title: string;
  raw_refreshed_at: string;
  duration_sec: number | null;
  shorts_classification: string | null;
}

interface StoredSubRow {
  id: string;
  status: string;
  lease_expires_at: string | null;
}

function createV2MockDb(seedItems: StoredItemRow[] = [], seedSubs: StoredSubRow[] = []) {
  const accounts = new Map<string, { id: string; handle: string; display_name: string }>();
  const items = new Map<string, StoredItemRow>(
    seedItems.map((i) => [`${i.platform}:${i.external_id}`, i]),
  );
  const stats = new Map<string, { views: number; likes: number | null; comments: number | null }>();
  const liveSamples: Array<{ item_id: string; viewers: number }> = [];
  const subs = [...seedSubs];

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('SELECT COUNT(*) AS cnt FROM items')) {
                const platform = sql.includes("'twitch'") ? 'twitch' : 'youtube';
                const ext = String(args[0]);
                const acctId = `acct:${platform}:${ext}`;
                let cnt = 0;
                for (const item of items.values()) {
                  if (item.platform === platform && item.id.startsWith(`item:${platform}:`)) {
                    if (acctId) cnt++;
                  }
                }
                return { cnt } as T;
              }
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
              if (sql.includes('FROM webhook_subscriptions')) {
                const horizon = String(args[0]);
                const cnt = subs.filter(
                  (s) => s.status === 'active' && s.lease_expires_at && s.lease_expires_at <= horizon,
                ).length;
                return { cnt } as T;
              }
              return null;
            },
            async all<T>() {
              return { results: [] as T[] };
            },
            async run() {
              if (sql.includes("DELETE FROM items WHERE platform = 'youtube'")) {
                const cutoff = String(args[0]);
                let changes = 0;
                for (const [k, v] of items.entries()) {
                  if (v.platform === 'youtube' && v.raw_refreshed_at < cutoff) {
                    items.delete(k);
                    changes++;
                  }
                }
                return { success: true, meta: { changes } };
              }
              if (sql.includes('UPDATE webhook_subscriptions')) {
                const threshold = String(args[1]);
                let changes = 0;
                for (const s of subs) {
                  if (s.status === 'active' && s.lease_expires_at && s.lease_expires_at <= threshold) {
                    s.status = 'expired';
                    changes++;
                  }
                }
                return { success: true, meta: { changes } };
              }
              if (sql.includes('INSERT INTO platform_accounts')) {
                const id = String(args[0]);
                const key = `${String(args[1])}:${String(args[2])}`;
                accounts.set(key, {
                  id,
                  handle: String(args[3]),
                  display_name: String(args[4]),
                });
              } else if (sql.includes('INSERT INTO items')) {
                const id = String(args[0]);
                const platform = String(args[2]);
                const external_id = String(args[3]);
                const kind = String(args[4]);
                const title = String(args[5]);
                const raw_refreshed_at = String(args[10]);
                const duration_sec = (args[12] as number | null) ?? null;
                const shorts_classification = (args[13] as string | null) ?? null;
                items.set(`${platform}:${external_id}`, {
                  id,
                  platform,
                  external_id,
                  kind,
                  title,
                  raw_refreshed_at,
                  duration_sec,
                  shorts_classification,
                });
              } else if (sql.includes('INSERT OR IGNORE INTO item_stats')) {
                stats.set(String(args[0]), {
                  views: Number(args[3]),
                  likes: args[4] !== null ? Number(args[4]) : null,
                  comments: args[5] !== null ? Number(args[5]) : null,
                });
              } else if (sql.includes('INSERT OR IGNORE INTO live_samples')) {
                liveSamples.push({ item_id: String(args[1]), viewers: Number(args[3]) });
              }
              return { success: true, meta: { changes: 0 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, accounts, items, stats, liveSamples, subs };
}

describe('V2 Twitch/Kick sync, YouTube enrichment, and 30-day compliance', () => {
  it('syncs Twitch channel, VODs, live stream, and clips via OAuth app token', async () => {
    clearTwitchTokenCache();
    const { db, accounts, items, liveSamples } = createV2MockDb();

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (url === 'https://id.twitch.tv/oauth2/token') {
        return Response.json({ access_token: 'tw-tok', expires_in: 3600, token_type: 'bearer' });
      }
      if (url.includes('/helix/users')) {
        return Response.json({
          data: [{ id: '1001', login: 'shroud', display_name: 'Shroud' }],
        });
      }
      if (url.includes('/helix/videos')) {
        return Response.json({
          data: [
            {
              id: 'vod-1',
              user_id: '1001',
              title: 'Valorant Stream VOD',
              url: 'https://www.twitch.tv/videos/vod-1',
              view_count: 15000,
              created_at: '2026-11-26T18:00:00Z',
              type: 'archive',
            },
          ],
        });
      }
      if (url.includes('/helix/streams')) {
        return Response.json({
          data: [
            {
              id: 'stream-99',
              user_id: '1001',
              title: 'Live Now',
              viewer_count: 8500,
              started_at: '2026-11-26T20:00:00Z',
              type: 'live',
            },
          ],
        });
      }
      if (url.includes('/helix/clips')) {
        return Response.json({
          data: [
            {
              id: 'clip-77',
              broadcaster_id: '1001',
              creator_name: 'fan1',
              video_id: 'vod-1',
              title: 'Ace Clutch',
              url: 'https://clips.twitch.tv/clip-77',
              view_count: 320,
              created_at: '2026-11-26T20:10:00Z',
              duration: 29.4,
              vod_offset: 600,
            },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    };

    const res = await syncPlatformAccount(
      db,
      { DB: db, TWITCH_CLIENT_ID: 'tw-cid', TWITCH_CLIENT_SECRET: 'tw-sec' },
      { platform: 'twitch', externalId: 'shroud' },
      { fetchFn, nowIso: '2026-11-26T20:15:00Z' },
    );

    expect(res).toMatchObject({
      ok: true,
      status: 'synced',
      itemsSynced: 1,
      resolvedExternalId: '1001',
      channelName: 'Shroud',
    });
    expect(accounts.get('twitch:1001')?.display_name).toBe('Shroud');
    expect(items.get('twitch:vod-1')?.kind).toBe('vod');
    expect(items.get('twitch:clip-77')?.kind).toBe('clip');
    expect(liveSamples[0]?.viewers).toBe(8500);
  });

  it('syncs Kick channel & livestream via OAuth 2.1 app token', async () => {
    clearKickCaches();
    const { db, accounts, liveSamples } = createV2MockDb();

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (url === 'https://id.kick.com/oauth/token') {
        return Response.json({ access_token: 'kk-tok', expires_in: 3600, token_type: 'Bearer' });
      }
      if (url.includes('/public/v1/channels')) {
        return Response.json({
          data: [{ broadcaster_user_id: 777, slug: 'streamer777' }],
        });
      }
      if (url.includes('/public/v1/livestreams')) {
        return Response.json({
          data: [
            {
              broadcaster_user_id: 777,
              slug: 'streamer777',
              stream_title: 'Kick Ranked Grind',
              viewer_count: 2300,
              started_at: '2026-11-26T19:00:00Z',
            },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    };

    const res = await syncPlatformAccount(
      db,
      { DB: db, KICK_CLIENT_ID: 'kk-cid', KICK_CLIENT_SECRET: 'kk-sec' },
      { platform: 'kick', externalId: 'streamer777' },
      { fetchFn, nowIso: '2026-11-26T20:15:00Z' },
    );

    expect(res).toMatchObject({
      ok: true,
      status: 'synced',
      itemsSynced: 1,
      resolvedExternalId: '777',
    });
    expect(accounts.get('kick:777')?.handle).toBe('streamer777');
    expect(liveSamples[0]?.viewers).toBe(2300);
  });

  it('persists YouTube duration_sec, shorts_classification, likes, and comments when API key is set', async () => {
    const { db, items, stats } = createV2MockDb();

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('/channels')) {
        return Response.json({
          items: [{ id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', snippet: { title: 'TestChan', customUrl: '@testchan' } }],
        });
      }
      if (url.includes('/playlistItems')) {
        return Response.json({
          items: [
            {
              snippet: {
                channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
                title: 'Fast Short',
                publishedAt: '2026-11-26T18:00:00Z',
                resourceId: { videoId: 'ytV01' },
              },
            },
          ],
        });
      }
      if (url.includes('part=snippet%2CcontentDetails')) {
        return Response.json({
          items: [{ id: 'ytV01', contentDetails: { duration: 'PT42S' } }],
        });
      }
      if (url.includes('part=statistics')) {
        return Response.json({
          items: [{ id: 'ytV01', statistics: { viewCount: '9000', likeCount: '450', commentCount: '33' } }],
        });
      }
      return new Response('not found', { status: 404 });
    };

    const res = await syncPlatformAccount(
      db,
      { DB: db, YOUTUBE_API_KEY: 'yt-api-key' },
      { platform: 'youtube', externalId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' },
      { fetchFn, nowIso: '2026-11-26T20:15:00Z' },
    );

    expect(res.itemsSynced).toBe(1);
    expect(items.get('youtube:ytV01')).toMatchObject({
      duration_sec: 42,
      shorts_classification: 'short',
    });
    const statRow = [...stats.values()][0];
    expect(statRow).toEqual({ views: 9000, likes: 450, comments: 33 });
  });

  it('enforces YouTube 30-day compliance purge and marks expired webhook leases', async () => {
    const { db, items, subs } = createV2MockDb(
      [
        {
          id: 'item:youtube:old1',
          platform: 'youtube',
          external_id: 'old1',
          kind: 'video',
          title: 'Stale YT',
          raw_refreshed_at: '2026-10-01T00:00:00.000Z',
          duration_sec: 120,
          shorts_classification: 'video',
        },
        {
          id: 'item:youtube:fresh1',
          platform: 'youtube',
          external_id: 'fresh1',
          kind: 'video',
          title: 'Fresh YT',
          raw_refreshed_at: '2026-11-20T00:00:00.000Z',
          duration_sec: 120,
          shorts_classification: 'video',
        },
        {
          id: 'item:twitch:vod1',
          platform: 'twitch',
          external_id: 'vod1',
          kind: 'vod',
          title: 'Old Twitch',
          raw_refreshed_at: '2026-09-01T00:00:00.000Z',
          duration_sec: null,
          shorts_classification: null,
        },
      ],
      [
        { id: 'sub-expired', status: 'active', lease_expires_at: '2026-11-25T00:00:00.000Z' },
        { id: 'sub-renew', status: 'active', lease_expires_at: '2026-11-27T12:00:00.000Z' },
      ],
    );

    const report = await enforceYouTube30DayCompliance(db, '2026-11-27T00:00:00.000Z');
    expect(report).toEqual({
      purgedYouTubeItems: 1,
      expiredSubscriptions: 1,
      leasesNeedingRenewal: 1,
    });
    expect(items.has('youtube:old1')).toBe(false);
    expect(items.has('youtube:fresh1')).toBe(true);
    expect(items.has('twitch:vod1')).toBe(true);
    expect(subs[0]?.status).toBe('expired');
  });

  it('verifies provider connections honestly for YouTube, Twitch, and Kick', async () => {
    clearTwitchTokenCache();
    clearKickCaches();

    const unconfiguredTw = await verifyProviderCredentials({ DB: {} as D1Database }, 'twitch');
    expect(unconfiguredTw.status).toBe('not_configured');

    const unconfiguredKk = await verifyProviderCredentials({ DB: {} as D1Database }, 'kick');
    expect(unconfiguredKk.status).toBe('not_configured');

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('feeds/videos.xml')) {
        return new Response('<feed><title>Google Developers</title></feed>', { status: 200 });
      }
      if (url === 'https://id.twitch.tv/oauth2/token') {
        return Response.json({ access_token: 'tw-tok', expires_in: 3600, token_type: 'bearer' });
      }
      if (url === 'https://id.kick.com/oauth/token') {
        return Response.json({ access_token: 'kk-tok', expires_in: 3600, token_type: 'Bearer' });
      }
      if (url === 'https://api.kick.com/public/v1/public-key') {
        return Response.json({ data: { public_key: 'pk-pem' } });
      }
      return new Response('err', { status: 500 });
    };

    const ytCheck = await verifyProviderCredentials({ DB: {} as D1Database }, 'youtube', { fetchFn });
    expect(ytCheck).toMatchObject({ ok: true, status: 'healthy', mode: 'public_feed' });

    const twCheck = await verifyProviderCredentials(
      { DB: {} as D1Database, TWITCH_CLIENT_ID: 'c', TWITCH_CLIENT_SECRET: 's' },
      'twitch',
      { fetchFn },
    );
    expect(twCheck).toMatchObject({ ok: true, status: 'healthy', mode: 'oauth_app_token' });

    const kkCheck = await verifyProviderCredentials(
      { DB: {} as D1Database, KICK_CLIENT_ID: 'c', KICK_CLIENT_SECRET: 's' },
      'kick',
      { fetchFn },
    );
    expect(kkCheck).toMatchObject({ ok: true, status: 'healthy', mode: 'oauth_app_token' });
  });
});
