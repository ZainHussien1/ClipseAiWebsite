import { describe, expect, it } from 'vitest';
import {
  parseYouTubePublicFeed,
  resolveYouTubeChannelPublic,
  YouTubePublicProvider,
} from './youtube-public.js';

const PUBLIC_ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>MKBHD</title>
  <entry>
    <yt:videoId>abc12345678</yt:videoId>
    <yt:channelId>UCBJycsmduvYEL83R_U4JriQ</yt:channelId>
    <title>Smartphone Awards &amp; More</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc12345678"/>
    <published>2026-11-26T09:00:00+00:00</published>
    <updated>2026-11-26T09:05:00+00:00</updated>
    <media:group>
      <media:thumbnail url="https://i1.ytimg.com/vi/abc12345678/hqdefault.jpg"/>
      <media:community>
        <media:statistics views="450123"/>
      </media:community>
    </media:group>
  </entry>
  <entry>
    <yt:videoId>shr98765432</yt:videoId>
    <yt:channelId>UCBJycsmduvYEL83R_U4JriQ</yt:channelId>
    <title>Quick Short</title>
    <link rel="alternate" href="https://www.youtube.com/shorts/shr98765432"/>
    <published>2026-11-26T08:00:00+00:00</published>
    <updated>2026-11-26T08:00:00+00:00</updated>
    <media:group>
      <media:thumbnail url="https://i1.ytimg.com/vi/shr98765432/hqdefault.jpg"/>
      <media:community>
        <media:statistics views="120000"/>
      </media:community>
    </media:group>
  </entry>
</feed>`;

describe('YouTubePublicProvider', () => {
  it('parses public Atom feed with channel title, Shorts, thumbnails, and view counts', () => {
    const parsed = parseYouTubePublicFeed(PUBLIC_ATOM_FIXTURE, '2026-11-26T10:00:00Z');
    expect(parsed.channelTitle).toBe('MKBHD');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({
      externalId: 'abc12345678',
      kind: 'video',
      title: 'Smartphone Awards & More',
      thumbnailUrl: 'https://i1.ytimg.com/vi/abc12345678/hqdefault.jpg',
    });
    expect(parsed.items[1]).toMatchObject({
      externalId: 'shr98765432',
      kind: 'short',
      url: 'https://www.youtube.com/shorts/shr98765432',
    });
    expect(parsed.stats).toEqual([
      { externalId: 'abc12345678', capturedAt: '2026-11-26T10:00:00Z', views: 450123 },
      { externalId: 'shr98765432', capturedAt: '2026-11-26T10:00:00Z', views: 120000 },
    ]);
  });

  it('resolves @handle via fixed https://www.youtube.com origin and fetches feed without API key', async () => {
    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (url === 'https://www.youtube.com/%40mkbhd') {
        return new Response(
          '<html><head><meta property="og:title" content="MKBHD"><link rel="canonical" href="https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ"></head></html>',
          { status: 200 },
        );
      }
      if (url === 'https://www.youtube.com/feeds/videos.xml?channel_id=UCBJycsmduvYEL83R_U4JriQ') {
        return new Response(PUBLIC_ATOM_FIXTURE, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const resolved = await resolveYouTubeChannelPublic('@mkbhd', fetchFn);
    expect(resolved).toEqual({
      channelId: 'UCBJycsmduvYEL83R_U4JriQ',
      feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCBJycsmduvYEL83R_U4JriQ',
      channelTitle: 'MKBHD',
    });

    const provider = new YouTubePublicProvider(fetchFn);
    const channel = await provider.fetchChannel('@mkbhd');
    expect(channel).toEqual({
      platform: 'youtube',
      externalId: 'UCBJycsmduvYEL83R_U4JriQ',
      handle: '@mkbhd',
      displayName: 'MKBHD',
    });

    const items = await provider.fetchRecentItems('UCBJycsmduvYEL83R_U4JriQ');
    expect(items).toHaveLength(2);
  });
});
