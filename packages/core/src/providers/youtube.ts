import { z } from 'zod';
import { AppError } from '../types.js';
import type {
  Provider,
  ProviderChannel,
  ProviderItem,
  ProviderItemStats,
  ProviderLiveStatus,
} from '../ports.js';
import { TokenBucketQuotaGovernor } from './quota.js';
import { classifyShort } from './shorts.js';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const YOUTUBE_API_ORIGIN = 'https://www.googleapis.com/youtube/v3';

export interface YouTubeWebSubEntry {
  readonly videoId: string;
  readonly channelId: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly isEdit: boolean;
}

function extractTag(xml: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i').exec(xml);
  return match?.[1]?.trim();
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Parses a YouTube WebSub Atom XML notification into normalized entries.
 * Notifications also fire on title/description edits (`updated > published`).
 */
export function parseYouTubeWebSubAtom(xml: string): readonly YouTubeWebSubEntry[] {
  const entries: YouTubeWebSubEntry[] = [];
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;

  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const videoId = extractTag(block, 'yt:videoId');
    const channelId = extractTag(block, 'yt:channelId');
    const rawTitle = extractTag(block, 'title');
    const publishedAt = extractTag(block, 'published');
    const updatedAt = extractTag(block, 'updated') ?? publishedAt;
    const linkMatch = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(block);

    if (!videoId || !channelId || !rawTitle || !publishedAt || !updatedAt) {
      continue;
    }
    const candidateUrl = linkMatch?.[1] ?? `https://www.youtube.com/watch?v=${videoId}`;
    const safeUrl = candidateUrl.startsWith('https://')
      ? candidateUrl
      : `https://www.youtube.com/watch?v=${videoId}`;

    const publishedMs = Date.parse(publishedAt);
    const updatedMs = Date.parse(updatedAt);
    const isEdit =
      Number.isFinite(publishedMs) &&
      Number.isFinite(updatedMs) &&
      updatedMs - publishedMs > 5 * 60_000;

    entries.push({
      videoId,
      channelId,
      title: decodeXmlEntities(rawTitle),
      url: safeUrl,
      publishedAt,
      updatedAt,
      isEdit,
    });
  }

  return entries;
}

export function parseIso8601Duration(iso: string): number | null {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(iso.trim());
  if (!match) return null;
  const hours = Number(match[1] ?? '0');
  const minutes = Number(match[2] ?? '0');
  const seconds = Number(match[3] ?? '0');
  return hours * 3600 + minutes * 60 + seconds;
}

const ytChannelResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        snippet: z.object({
          title: z.string().min(1),
          customUrl: z.string().optional(),
          thumbnails: z
            .object({
              default: z.object({ url: z.string().url() }).optional(),
              medium: z.object({ url: z.string().url() }).optional(),
            })
            .optional(),
        }),
      }),
    )
    .default([]),
});

const ytPlaylistItemsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        snippet: z.object({
          channelId: z.string().min(1),
          title: z.string().min(1),
          publishedAt: z.string().min(1),
          resourceId: z.object({
            videoId: z.string().min(1),
          }),
          thumbnails: z
            .object({
              medium: z.object({ url: z.string().url() }).optional(),
              high: z.object({ url: z.string().url() }).optional(),
            })
            .optional(),
        }),
      }),
    )
    .default([]),
});

const ytVideosResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        snippet: z
          .object({
            channelId: z.string().min(1),
            title: z.string().min(1),
            publishedAt: z.string().min(1),
            liveBroadcastContent: z.string().optional(),
          })
          .optional(),
        contentDetails: z
          .object({
            duration: z.string().optional(),
          })
          .optional(),
        statistics: z
          .object({
            viewCount: z.string().optional(),
            likeCount: z.string().optional(),
            commentCount: z.string().optional(),
          })
          .optional(),
        liveStreamingDetails: z
          .object({
            concurrentViewers: z.string().optional(),
            actualStartTime: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

export interface YouTubeProviderOptions {
  readonly apiKey: string;
  readonly fetchFn?: FetchLike;
  readonly quota?: TokenBucketQuotaGovernor;
}

export class YouTubeProvider implements Provider {
  readonly platform = 'youtube' as const;
  private readonly apiKey: string;
  private readonly fetchFn: FetchLike;
  private readonly quota: TokenBucketQuotaGovernor;

  constructor(options: YouTubeProviderOptions) {
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.quota = options.quota ?? new TokenBucketQuotaGovernor();
  }

  private async getJson<T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    cost = 1,
  ): Promise<T> {
    if (!this.quota.consume('youtube', cost)) {
      throw AppError.rateLimited('YouTube quota governor exhausted or circuit open');
    }
    const url = new URL(`${YOUTUBE_API_ORIGIN}/${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    url.searchParams.set('key', this.apiKey);

    const res = await this.fetchFn(url.toString(), {
      method: 'GET',
      redirect: 'error',
    });

    if (res.status === 429 || res.status === 403) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '0');
      this.quota.recordRateLimit('youtube', Number.isFinite(retryAfter) ? retryAfter : undefined);
      throw AppError.rateLimited(`YouTube API rate limited (${res.status})`);
    }
    if (!res.ok) {
      throw AppError.internal(`YouTube API error (${res.status})`);
    }
    const raw: unknown = await res.json();
    return schema.parse(raw);
  }

  async fetchChannel(externalIdOrHandle: string): Promise<ProviderChannel | null> {
    const trimmed = externalIdOrHandle.trim();
    const params: Record<string, string> = { part: 'snippet' };
    if (trimmed.startsWith('UC')) {
      params['id'] = trimmed;
    } else if (trimmed.startsWith('@')) {
      params['forHandle'] = trimmed;
    } else {
      params['forUsername'] = trimmed;
    }

    const data = await this.getJson('channels', params, ytChannelResponseSchema, 1);
    const ch = data.items[0];
    if (!ch) return null;

    return {
      platform: 'youtube',
      externalId: ch.id,
      handle: ch.snippet.customUrl ?? ch.id,
      displayName: ch.snippet.title,
      avatarUrl: ch.snippet.thumbnails?.medium?.url ?? ch.snippet.thumbnails?.default?.url,
    };
  }

  async fetchRecentItems(accountExternalId: string): Promise<readonly ProviderItem[]> {
    const uploadsPlaylistId = accountExternalId.startsWith('UC')
      ? `UU${accountExternalId.slice(2)}`
      : accountExternalId;

    const playlist = await this.getJson(
      'playlistItems',
      {
        part: 'snippet',
        playlistId: uploadsPlaylistId,
        maxResults: '25',
      },
      ytPlaylistItemsResponseSchema,
      1,
    );

    const videoIds = playlist.items.map((item) => item.snippet.resourceId.videoId);
    if (videoIds.length === 0) return [];

    const details = await this.getJson(
      'videos',
      {
        part: 'snippet,contentDetails',
        id: videoIds.slice(0, 50).join(','),
      },
      ytVideosResponseSchema,
      1,
    );
    const detailsById = new Map(details.items.map((v) => [v.id, v]));

    return playlist.items.map((entry) => {
      const videoId = entry.snippet.resourceId.videoId;
      const detail = detailsById.get(videoId);
      const durationSec = detail?.contentDetails?.duration
        ? parseIso8601Duration(detail.contentDetails.duration)
        : null;
      const isLive = detail?.snippet?.liveBroadcastContent === 'live';
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const shortCheck = classifyShort({
        durationSec,
        url: watchUrl,
        title: entry.snippet.title,
      });

      return {
        platform: 'youtube',
        externalId: videoId,
        accountExternalId: entry.snippet.channelId,
        kind: isLive ? 'live' : shortCheck.isShort ? 'short' : 'video',
        title: entry.snippet.title,
        url: shortCheck.isShort ? `https://www.youtube.com/shorts/${videoId}` : watchUrl,
        thumbnailUrl:
          entry.snippet.thumbnails?.high?.url ?? entry.snippet.thumbnails?.medium?.url,
        publishedAt: entry.snippet.publishedAt,
        durationSec: durationSec ?? undefined,
        shortsClassification: isLive ? 'live' : shortCheck.classification,
      };
    });
  }

  async fetchStatsBatch(externalIds: readonly string[]): Promise<readonly ProviderItemStats[]> {
    if (externalIds.length === 0) return [];
    const results: ProviderItemStats[] = [];
    const capturedAt = new Date().toISOString();

    for (let i = 0; i < externalIds.length; i += 50) {
      const chunk = externalIds.slice(i, i + 50);
      const data = await this.getJson(
        'videos',
        { part: 'statistics', id: chunk.join(',') },
        ytVideosResponseSchema,
        1,
      );
      for (const item of data.items) {
        const stats = item.statistics;
        if (!stats) continue;
        results.push({
          externalId: item.id,
          capturedAt,
          views: Number(stats.viewCount ?? '0'),
          likes: stats.likeCount !== undefined ? Number(stats.likeCount) : undefined,
          comments: stats.commentCount !== undefined ? Number(stats.commentCount) : undefined,
        });
      }
    }

    return results;
  }

  async fetchLiveStatus(
    accountExternalIds: readonly string[],
  ): Promise<readonly ProviderLiveStatus[]> {
    if (accountExternalIds.length === 0) return [];
    const data = await this.getJson(
      'videos',
      {
        part: 'snippet,liveStreamingDetails',
        id: accountExternalIds.slice(0, 50).join(','),
      },
      ytVideosResponseSchema,
      1,
    );

    return data.items.map((item) => {
      const isLive = item.snippet?.liveBroadcastContent === 'live';
      const viewersRaw = item.liveStreamingDetails?.concurrentViewers;
      return {
        accountExternalId: item.snippet?.channelId ?? item.id,
        isLive,
        streamExternalId: item.id,
        title: item.snippet?.title,
        viewers: viewersRaw !== undefined ? Number(viewersRaw) : undefined,
        startedAt: item.liveStreamingDetails?.actualStartTime,
      };
    });
  }
}
