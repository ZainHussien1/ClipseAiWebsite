import { describe, expect, it } from 'vitest';
import { AppError } from '../types.js';
import { KickProvider } from './kick.js';
import { TokenBucketQuotaGovernor } from './quota.js';
import { TwitchProvider } from './twitch.js';
import { parseYouTubeWebSubAtom, YouTubeProvider } from './youtube.js';

const YOUTUBE_ATOM_NEW_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:dQw4w9WgXcQ</id>
    <yt:videoId>dQw4w9WgXcQ</yt:videoId>
    <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
    <title>New Stream Highlights &amp; Clips</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
    <published>2026-11-26T10:00:00+00:00</published>
    <updated>2026-11-26T10:01:00+00:00</updated>
  </entry>
</feed>`;

const YOUTUBE_ATOM_EDIT_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>dQw4w9WgXcQ</yt:videoId>
    <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
    <title>Edited Title</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
    <published>2026-11-26T10:00:00+00:00</published>
    <updated>2026-11-26T10:45:00+00:00</updated>
  </entry>
</feed>`;

describe('YouTubeProvider & WebSub parser', () => {
  it('parses WebSub Atom XML and detects edits vs new uploads', () => {
    const fresh = parseYouTubeWebSubAtom(YOUTUBE_ATOM_NEW_FIXTURE);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({
      videoId: 'dQw4w9WgXcQ',
      channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
      title: 'New Stream Highlights & Clips',
      isEdit: false,
    });

    const edited = parseYouTubeWebSubAtom(YOUTUBE_ATOM_EDIT_FIXTURE);
    expect(edited[0]?.isEdit).toBe(true);
  });

  it('fetches channel, recent items (Shorts + video), and stats with hidden likes', async () => {
    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('/channels')) {
        return Response.json({
          items: [
            {
              id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
              snippet: { title: 'Creator One', customUrl: '@creatorone' },
            },
          ],
        });
      }
      if (url.includes('/playlistItems')) {
        return Response.json({
          items: [
            {
              snippet: {
                channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
                title: 'Short Clip',
                publishedAt: '2026-11-26T10:00:00Z',
                resourceId: { videoId: 'vidShort01' },
              },
            },
          ],
        });
      }
      if (url.includes('part=snippet%2CcontentDetails')) {
        return Response.json({
          items: [{ id: 'vidShort01', contentDetails: { duration: 'PT45S' } }],
        });
      }
      if (url.includes('part=statistics')) {
        return Response.json({
          items: [{ id: 'vidShort01', statistics: { viewCount: '12345' } }],
        });
      }
      return new Response('not found', { status: 404 });
    };

    const yt = new YouTubeProvider({ apiKey: 'test-key', fetchFn });
    const ch = await yt.fetchChannel('UC_x5XG1OV2P6uZZ5FSM9Ttw');
    expect(ch?.handle).toBe('@creatorone');

    const items = await yt.fetchRecentItems('UC_x5XG1OV2P6uZZ5FSM9Ttw');
    expect(items[0]).toMatchObject({
      externalId: 'vidShort01',
      kind: 'short',
      url: 'https://www.youtube.com/shorts/vidShort01',
    });

    const stats = await yt.fetchStatsBatch(['vidShort01']);
    expect(stats[0]).toMatchObject({
      externalId: 'vidShort01',
      views: 12345,
      likes: undefined,
      comments: undefined,
    });
  });

  it('triggers quota circuit breaker on 429', async () => {
    const quota = new TokenBucketQuotaGovernor();
    const yt = new YouTubeProvider({
      apiKey: 'test-key',
      quota,
      fetchFn: async () => new Response('rate limit', { status: 429, headers: { 'Retry-After': '60' } }),
    });

    await expect(yt.fetchChannel('UC_x5XG1OV2P6uZZ5FSM9Ttw')).rejects.toThrow(AppError);
    expect(quota.isDegraded('youtube')).toBe(true);
  });
});

describe('TwitchProvider', () => {
  it('handles Helix Get Streams and Get Clips with null/empty vod_offset', async () => {
    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('/streams')) {
        return Response.json({
          data: [
            {
              id: 'stream-1',
              user_id: '1001',
              title: 'Live Ranked',
              viewer_count: 4200,
              started_at: '2026-11-26T09:00:00Z',
              type: 'live',
            },
          ],
        });
      }
      if (url.includes('/clips')) {
        return Response.json({
          data: [
            {
              id: 'clip-1',
              broadcaster_id: '1001',
              creator_name: 'viewer_a',
              video_id: '',
              title: 'Huge play',
              url: 'https://clips.twitch.tv/clip-1',
              view_count: 50,
              created_at: '2026-11-26T09:15:00Z',
              duration: 28.5,
              vod_offset: null,
            },
          ],
        });
      }
      return Response.json({ data: [] });
    };

    const twitch = new TwitchProvider({
      clientId: 'cid',
      appAccessToken: 'tok',
      fetchFn,
    });

    const live = await twitch.fetchLiveStatus(['1001', '1002']);
    expect(live).toEqual([
      {
        accountExternalId: '1001',
        isLive: true,
        streamExternalId: 'stream-1',
        title: 'Live Ranked',
        viewers: 4200,
        startedAt: '2026-11-26T09:00:00Z',
      },
      { accountExternalId: '1002', isLive: false },
    ]);

    const clips = await twitch.fetchClipsSince('1001', '2026-11-26T09:00:00Z');
    expect(clips[0]).toMatchObject({
      id: 'clip-1',
      videoId: null,
      vodOffsetSec: null,
    });
  });
});

describe('KickProvider', () => {
  it('fetches official /public/v1/livestreams and returns empty for unsupported clips/VODs', async () => {
    const kick = new KickProvider({
      accessToken: 'kick-tok',
      fetchFn: async (input) => {
        const url = String(input);
        if (url.includes('/livestreams')) {
          return Response.json({
            data: [
              {
                broadcaster_user_id: 777,
                slug: 'streamer777',
                stream_title: 'Kick Live',
                viewer_count: 1500,
                started_at: '2026-11-26T08:00:00Z',
              },
            ],
          });
        }
        return Response.json({ data: [] });
      },
    });

    expect(await kick.fetchRecentItems('777')).toEqual([]);
    const status = await kick.fetchLiveStatus(['777', '888']);
    expect(status[0]).toMatchObject({
      accountExternalId: '777',
      isLive: true,
      viewers: 1500,
    });
    expect(status[1]).toEqual({ accountExternalId: '888', isLive: false });
  });
});
