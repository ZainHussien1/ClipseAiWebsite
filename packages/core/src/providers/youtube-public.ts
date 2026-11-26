import { AppError } from '../types.js';
import type {
  Provider,
  ProviderChannel,
  ProviderItem,
  ProviderItemStats,
  ProviderLiveStatus,
} from '../ports.js';
import { classifyShort } from './shorts.js';
import type { FetchLike } from './youtube.js';

const YOUTUBE_PUBLIC_ORIGIN = 'https://www.youtube.com';
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_RE = /^@[A-Za-z0-9._-]{3,30}$/;

export interface ResolvedYouTubePublicChannel {
  readonly channelId: string;
  readonly feedUrl: string;
  readonly channelTitle?: string;
}

export interface ParsedYouTubePublicFeed {
  readonly channelTitle?: string;
  readonly items: readonly ProviderItem[];
  readonly stats: readonly ProviderItemStats[];
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(xml: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i').exec(xml);
  return match?.[1]?.trim();
}

export function buildYouTubeFeedUrl(channelId: string): string {
  if (!CHANNEL_ID_RE.test(channelId)) {
    throw AppError.badRequest('Invalid YouTube channel ID');
  }
  return `${YOUTUBE_PUBLIC_ORIGIN}/feeds/videos.xml?channel_id=${channelId}`;
}

export async function resolveYouTubeChannelPublic(
  idOrHandle: string,
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<ResolvedYouTubePublicChannel | null> {
  const trimmed = idOrHandle.trim();
  if (CHANNEL_ID_RE.test(trimmed)) {
    return {
      channelId: trimmed,
      feedUrl: buildYouTubeFeedUrl(trimmed),
    };
  }

  if (!HANDLE_RE.test(trimmed)) {
    return null;
  }

  const targetUrl = `${YOUTUBE_PUBLIC_ORIGIN}/${encodeURIComponent(trimmed)}`;
  const res = await fetchFn(targetUrl, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(5000),
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'ClipseRadar/1.0 (+https://www.youtube.com)',
    },
  });

  if (res.url && !res.url.startsWith(`${YOUTUBE_PUBLIC_ORIGIN}/`)) {
    throw AppError.badRequest('Unexpected redirect host while resolving YouTube handle');
  }
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw AppError.internal(`YouTube channel page returned ${res.status}`);
  }

  const html = await res.text();
  const idMatch =
    /"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/.exec(html) ??
    /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})["']/i.exec(
      html,
    ) ??
    /"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/.exec(html);

  const channelId = idMatch?.[1];
  if (!channelId) {
    return null;
  }

  const ogTitle = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const rawTitle = ogTitle ?? extractTag(html, 'title')?.replace(/\s*-\s*YouTube$/i, '');

  return {
    channelId,
    feedUrl: buildYouTubeFeedUrl(channelId),
    channelTitle: rawTitle ? decodeXmlEntities(rawTitle) : undefined,
  };
}

export function parseYouTubePublicFeed(
  xml: string,
  capturedAt = new Date().toISOString(),
): ParsedYouTubePublicFeed {
  const feedHeader = xml.split('<entry')[0] ?? xml;
  const rawChannelTitle = extractTag(feedHeader, 'title');
  const channelTitle = rawChannelTitle ? decodeXmlEntities(rawChannelTitle) : undefined;

  const items: ProviderItem[] = [];
  const stats: ProviderItemStats[] = [];
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;

  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const videoId = extractTag(block, 'yt:videoId');
    const channelId = extractTag(block, 'yt:channelId');
    const rawTitle = extractTag(block, 'title');
    const publishedAt = extractTag(block, 'published');
    const linkHref = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(block)?.[1];
    const thumbUrl = /<media:thumbnail\b[^>]*url=["']([^"']+)["'][^>]*>/i.exec(block)?.[1];
    const viewsRaw = /<media:statistics\b[^>]*views=["'](\d+)["'][^>]*>/i.exec(block)?.[1];

    if (!videoId || !channelId || !rawTitle || !publishedAt) {
      continue;
    }

    const title = decodeXmlEntities(rawTitle);
    const candidateUrl = linkHref ?? `https://www.youtube.com/watch?v=${videoId}`;
    const safeUrl = candidateUrl.startsWith('https://')
      ? candidateUrl
      : `https://www.youtube.com/watch?v=${videoId}`;
    const shortCheck = classifyShort({ url: safeUrl, title });

    items.push({
      platform: 'youtube',
      externalId: videoId,
      accountExternalId: channelId,
      kind: shortCheck.isShort ? 'short' : 'video',
      title,
      url: shortCheck.isShort ? `https://www.youtube.com/shorts/${videoId}` : safeUrl,
      thumbnailUrl: thumbUrl && thumbUrl.startsWith('https://') ? thumbUrl : undefined,
      publishedAt,
    });

    if (viewsRaw !== undefined) {
      stats.push({
        externalId: videoId,
        capturedAt,
        views: Number(viewsRaw),
      });
    }
  }

  return { channelTitle, items, stats };
}

export class YouTubePublicProvider implements Provider {
  readonly platform = 'youtube' as const;
  private readonly fetchFn: FetchLike;

  constructor(fetchFn: FetchLike = globalThis.fetch.bind(globalThis)) {
    this.fetchFn = fetchFn;
  }

  async fetchFeedByChannelId(channelId: string): Promise<ParsedYouTubePublicFeed> {
    const feedUrl = buildYouTubeFeedUrl(channelId);
    const res = await this.fetchFn(feedUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      headers: {
        Accept: 'application/atom+xml,application/xml,text/xml',
        'User-Agent': 'ClipseRadar/1.0 (+https://www.youtube.com)',
      },
    });

    if (res.url && !res.url.startsWith(`${YOUTUBE_PUBLIC_ORIGIN}/`)) {
      throw AppError.badRequest('Unexpected redirect host while fetching YouTube feed');
    }

    if (res.status === 429) {
      throw AppError.rateLimited('YouTube public feed rate limited (429)');
    }
    if (!res.ok) {
      throw AppError.internal(`YouTube public feed error (${res.status})`);
    }
    const xml = await res.text();
    return parseYouTubePublicFeed(xml);
  }

  async fetchChannel(externalIdOrHandle: string): Promise<ProviderChannel | null> {
    const resolved = await resolveYouTubeChannelPublic(externalIdOrHandle, this.fetchFn);
    if (!resolved) return null;

    let displayName = resolved.channelTitle;
    if (!displayName) {
      const feed = await this.fetchFeedByChannelId(resolved.channelId);
      displayName = feed.channelTitle ?? resolved.channelId;
    }

    const handle = externalIdOrHandle.trim().startsWith('@')
      ? externalIdOrHandle.trim().toLowerCase()
      : resolved.channelId;

    return {
      platform: 'youtube',
      externalId: resolved.channelId,
      handle,
      displayName,
    };
  }

  async fetchRecentItems(accountExternalId: string): Promise<readonly ProviderItem[]> {
    const resolved = await resolveYouTubeChannelPublic(accountExternalId, this.fetchFn);
    if (!resolved) return [];
    const feed = await this.fetchFeedByChannelId(resolved.channelId);
    return feed.items;
  }

  async fetchStatsBatch(_externalIds: readonly string[]): Promise<readonly ProviderItemStats[]> {
    return [];
  }

  async fetchLiveStatus(
    _accountExternalIds: readonly string[],
  ): Promise<readonly ProviderLiveStatus[]> {
    return [];
  }
}
