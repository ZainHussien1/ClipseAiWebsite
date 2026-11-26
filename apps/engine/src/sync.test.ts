import { describe, expect, it } from 'vitest';
import { syncPlatformAccount } from './sync.js';

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Veritasium</title>
  <entry>
    <yt:videoId>vidSync001</yt:videoId>
    <yt:channelId>UCHnyfMqiRRG1u-2MsSQLbXA</yt:channelId>
    <title>Physics Breakout Video</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=vidSync001"/>
    <published>2026-11-26T09:00:00+00:00</published>
    <updated>2026-11-26T09:05:00+00:00</updated>
    <media:group>
      <media:thumbnail url="https://i1.ytimg.com/vi/vidSync001/hqdefault.jpg"/>
      <media:community>
        <media:statistics views="50000"/>
      </media:community>
    </media:group>
  </entry>
</feed>`;

function createSyncMockDb() {
  const accounts = new Map<string, { id: string; handle: string; display_name: string }>();
  const items = new Map<string, { id: string; account_id: string; title: string }>();
  const stats = new Map<string, { views: number }>();
  const alerts: Array<{ id: string; type: string }> = [];

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
            async all<T>() {
              if (sql.includes('FROM follows f') && sql.includes('JOIN platform_accounts a')) {
                const canonical = String(args[0]);
                const original = String(args[1]);
                if (
                  accounts.has(`youtube:${canonical}`) ||
                  accounts.has(`youtube:${original}`)
                ) {
                  return { results: [{ workspace_id: 'ws-1' }] as T[] };
                }
                return { results: [] as T[] };
              }
              return { results: [] as T[] };
            },
            async run() {
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
                const account_id = String(args[1]);
                const key = `${String(args[2])}:${String(args[3])}`;
                items.set(key, { id, account_id, title: String(args[5]) });
              } else if (sql.includes('INSERT OR IGNORE INTO item_stats')) {
                stats.set(String(args[0]), { views: Number(args[3]) });
              } else if (sql.includes('INSERT INTO alerts')) {
                alerts.push({ id: String(args[0]), type: String(args[3]) });
              }
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, accounts, items, stats, alerts };
}

describe('syncPlatformAccount', () => {
  it('syncs real keyless YouTube channel via Atom feed and generates Rising alerts', async () => {
    const { db, accounts, items, stats, alerts } = createSyncMockDb();

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (url === 'https://www.youtube.com/%40veritasium') {
        return new Response(
          '<meta property="og:title" content="Veritasium"><link rel="canonical" href="https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA">',
          { status: 200 },
        );
      }
      if (url === 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA') {
        return new Response(ATOM_FEED, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const result = await syncPlatformAccount(
      db,
      { DB: db },
      { platform: 'youtube', externalId: '@veritasium' },
      { fetchFn, nowIso: '2026-11-26T10:00:00Z' },
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'synced',
      itemsSynced: 1,
      channelName: 'Veritasium',
      resolvedExternalId: 'UCHnyfMqiRRG1u-2MsSQLbXA',
    });
    expect(accounts.get('youtube:UCHnyfMqiRRG1u-2MsSQLbXA')).toMatchObject({
      handle: '@veritasium',
      display_name: 'Veritasium',
    });
    expect(items.get('youtube:vidSync001')).toMatchObject({
      account_id: 'acct:youtube:UCHnyfMqiRRG1u-2MsSQLbXA',
      title: 'Physics Breakout Video',
    });
    expect(stats.size).toBe(1);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('honestly reports credentials_missing for Twitch and Kick when unconfigured', async () => {
    const { db } = createSyncMockDb();

    const tw = await syncPlatformAccount(db, { DB: db }, { platform: 'twitch', externalId: 'shroud' });
    expect(tw.status).toBe('credentials_missing');
    expect(tw.itemsSynced).toBe(0);

    const kk = await syncPlatformAccount(db, { DB: db }, { platform: 'kick', externalId: 'xqc' });
    expect(kk.status).toBe('credentials_missing');
    expect(kk.itemsSynced).toBe(0);
  });
});
