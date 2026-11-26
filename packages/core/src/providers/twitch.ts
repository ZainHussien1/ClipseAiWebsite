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
import type { FetchLike } from './youtube.js';

const TWITCH_HELIX_ORIGIN = 'https://api.twitch.tv/helix';
const TWITCH_OAUTH_URL = 'https://id.twitch.tv/oauth2/token';

const twitchTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().min(1),
});

interface CachedAppToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

const twitchTokenCache = new Map<string, CachedAppToken>();

export function clearTwitchTokenCache(): void {
  twitchTokenCache.clear();
}

export async function exchangeTwitchAppToken(
  clientId: string,
  clientSecret: string,
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
  nowMs = Date.now(),
): Promise<{ accessToken: string; expiresAtMs: number }> {
  const cached = twitchTokenCache.get(clientId);
  if (cached && cached.expiresAtMs > nowMs + 60_000) {
    return cached;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });

  const res = await fetchFn(TWITCH_OAUTH_URL, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (res.status === 429) {
    throw AppError.rateLimited('Twitch OAuth token endpoint rate limited (429)');
  }
  if (!res.ok) {
    throw AppError.unauthorized(`Twitch OAuth token exchange failed (${res.status})`);
  }

  const parsed = twitchTokenResponseSchema.parse(await res.json());
  const entry: CachedAppToken = {
    accessToken: parsed.access_token,
    expiresAtMs: nowMs + parsed.expires_in * 1000,
  };
  twitchTokenCache.set(clientId, entry);
  return entry;
}

const twitchUsersResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        login: z.string().min(1),
        display_name: z.string().min(1),
        profile_image_url: z.string().url().optional(),
      }),
    )
    .default([]),
});

const twitchVideosResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        user_id: z.string().min(1),
        title: z.string().min(1),
        url: z.string().url(),
        thumbnail_url: z.string().optional(),
        view_count: z.number().int().nonnegative(),
        created_at: z.string().min(1),
        type: z.enum(['upload', 'archive', 'highlight']).optional(),
      }),
    )
    .default([]),
});

const twitchStreamsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        user_id: z.string().min(1),
        title: z.string(),
        viewer_count: z.number().int().nonnegative(),
        started_at: z.string().min(1),
        type: z.string(),
      }),
    )
    .default([]),
});

const twitchClipsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        broadcaster_id: z.string().min(1),
        creator_name: z.string().min(1),
        video_id: z.string().nullable().optional(),
        title: z.string().min(1),
        url: z.string().url(),
        thumbnail_url: z.string().url().optional(),
        view_count: z.number().int().nonnegative(),
        created_at: z.string().min(1),
        duration: z.number().nonnegative(),
        vod_offset: z.number().int().nonnegative().nullable().optional(),
      }),
    )
    .default([]),
});

export interface TwitchClipRecord {
  readonly id: string;
  readonly broadcasterId: string;
  readonly creatorName: string;
  readonly videoId: string | null;
  readonly title: string;
  readonly url: string;
  readonly viewCount: number;
  readonly createdAt: string;
  readonly durationSec: number;
  readonly vodOffsetSec: number | null;
}

export interface TwitchProviderOptions {
  readonly clientId: string;
  readonly appAccessToken: string;
  readonly fetchFn?: FetchLike;
  readonly quota?: TokenBucketQuotaGovernor;
}

function normalizeTwitchThumbnail(raw?: string): string | undefined {
  if (!raw) return undefined;
  const replaced = raw.replace('%{width}', '640').replace('%{height}', '360');
  return replaced.startsWith('https://') ? replaced : undefined;
}

export class TwitchProvider implements Provider {
  readonly platform = 'twitch' as const;
  private readonly clientId: string;
  private readonly appAccessToken: string;
  private readonly fetchFn: FetchLike;
  private readonly quota: TokenBucketQuotaGovernor;

  constructor(options: TwitchProviderOptions) {
    this.clientId = options.clientId;
    this.appAccessToken = options.appAccessToken;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.quota = options.quota ?? new TokenBucketQuotaGovernor();
  }

  private async getJson<T>(
    path: string,
    params: ReadonlyArray<readonly [string, string]>,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    if (!this.quota.consume('twitch', 1)) {
      throw AppError.rateLimited('Twitch quota governor exhausted or circuit open');
    }
    const url = new URL(`${TWITCH_HELIX_ORIGIN}/${path}`);
    for (const [k, v] of params) {
      url.searchParams.append(k, v);
    }

    const res = await this.fetchFn(url.toString(), {
      method: 'GET',
      redirect: 'error',
      headers: {
        'Client-Id': this.clientId,
        Authorization: `Bearer ${this.appAccessToken}`,
      },
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '0');
      this.quota.recordRateLimit('twitch', Number.isFinite(retryAfter) ? retryAfter : undefined);
      throw AppError.rateLimited('Twitch Helix API rate limited (429)');
    }
    if (!res.ok) {
      throw AppError.internal(`Twitch Helix API error (${res.status})`);
    }
    const raw: unknown = await res.json();
    return schema.parse(raw);
  }

  async fetchChannel(externalIdOrHandle: string): Promise<ProviderChannel | null> {
    const trimmed = externalIdOrHandle.trim();
    const paramKey = /^\d+$/.test(trimmed) ? 'id' : 'login';
    const data = await this.getJson('users', [[paramKey, trimmed.toLowerCase()]], twitchUsersResponseSchema);
    const user = data.data[0];
    if (!user) return null;

    return {
      platform: 'twitch',
      externalId: user.id,
      handle: user.login,
      displayName: user.display_name,
      avatarUrl: user.profile_image_url,
    };
  }

  async fetchRecentItems(accountExternalId: string): Promise<readonly ProviderItem[]> {
    const videos = await this.getJson(
      'videos',
      [
        ['user_id', accountExternalId],
        ['first', '20'],
      ],
      twitchVideosResponseSchema,
    );

    return videos.data.map((v) => ({
      platform: 'twitch',
      externalId: v.id,
      accountExternalId: v.user_id,
      kind: v.type === 'archive' ? 'vod' : 'video',
      title: v.title,
      url: v.url,
      thumbnailUrl: normalizeTwitchThumbnail(v.thumbnail_url),
      publishedAt: v.created_at,
    }));
  }

  async fetchClipsSince(
    broadcasterId: string,
    startedAtIso: string,
    endedAtIso?: string,
  ): Promise<readonly TwitchClipRecord[]> {
    const params: Array<readonly [string, string]> = [
      ['broadcaster_id', broadcasterId],
      ['started_at', startedAtIso],
      ['first', '100'],
    ];
    if (endedAtIso) {
      params.push(['ended_at', endedAtIso]);
    }
    const data = await this.getJson('clips', params, twitchClipsResponseSchema);
    return data.data.map((c) => ({
      id: c.id,
      broadcasterId: c.broadcaster_id,
      creatorName: c.creator_name,
      videoId: c.video_id && c.video_id.length > 0 ? c.video_id : null,
      title: c.title,
      url: c.url,
      viewCount: c.view_count,
      createdAt: c.created_at,
      durationSec: c.duration,
      vodOffsetSec: c.vod_offset ?? null,
    }));
  }

  async fetchStatsBatch(externalIds: readonly string[]): Promise<readonly ProviderItemStats[]> {
    if (externalIds.length === 0) return [];
    const results: ProviderItemStats[] = [];
    const capturedAt = new Date().toISOString();

    for (let i = 0; i < externalIds.length; i += 100) {
      const chunk = externalIds.slice(i, i + 100);
      const params = chunk.map((id) => ['id', id] as const);
      const data = await this.getJson('videos', params, twitchVideosResponseSchema);
      for (const video of data.data) {
        results.push({
          externalId: video.id,
          capturedAt,
          views: video.view_count,
        });
      }
    }

    return results;
  }

  async fetchLiveStatus(
    accountExternalIds: readonly string[],
  ): Promise<readonly ProviderLiveStatus[]> {
    if (accountExternalIds.length === 0) return [];
    const liveByUserId = new Map<string, z.infer<typeof twitchStreamsResponseSchema>['data'][number]>();

    for (let i = 0; i < accountExternalIds.length; i += 100) {
      const chunk = accountExternalIds.slice(i, i + 100);
      const params = chunk.map((id) => ['user_id', id] as const);
      const data = await this.getJson('streams', params, twitchStreamsResponseSchema);
      for (const stream of data.data) {
        if (stream.type === 'live') {
          liveByUserId.set(stream.user_id, stream);
        }
      }
    }

    return accountExternalIds.map((userId) => {
      const stream = liveByUserId.get(userId);
      if (!stream) {
        return { accountExternalId: userId, isLive: false };
      }
      return {
        accountExternalId: userId,
        isLive: true,
        streamExternalId: stream.id,
        title: stream.title,
        viewers: stream.viewer_count,
        startedAt: stream.started_at,
      };
    });
  }
}
