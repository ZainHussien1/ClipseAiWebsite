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

const KICK_API_ORIGIN = 'https://api.kick.com/public/v1';
const KICK_OAUTH_URL = 'https://id.kick.com/oauth/token';

const kickTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().min(1),
});

const kickPublicKeyResponseSchema = z.object({
  data: z.object({
    public_key: z.string().min(1),
  }),
});

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

interface CachedPublicKey {
  readonly publicKey: string;
  readonly expiresAtMs: number;
}

const kickTokenCache = new Map<string, CachedToken>();
let cachedKickPublicKey: CachedPublicKey | null = null;

export function clearKickCaches(): void {
  kickTokenCache.clear();
  cachedKickPublicKey = null;
}

export async function exchangeKickAppToken(
  clientId: string,
  clientSecret: string,
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
  nowMs = Date.now(),
): Promise<{ accessToken: string; expiresAtMs: number }> {
  const cached = kickTokenCache.get(clientId);
  if (cached && cached.expiresAtMs > nowMs + 60_000) {
    return cached;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });

  const res = await fetchFn(KICK_OAUTH_URL, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (res.status === 429) {
    throw AppError.rateLimited('Kick OAuth token endpoint rate limited (429)');
  }
  if (!res.ok) {
    throw AppError.unauthorized(`Kick OAuth token exchange failed (${res.status})`);
  }

  const parsed = kickTokenResponseSchema.parse(await res.json());
  const entry: CachedToken = {
    accessToken: parsed.access_token,
    expiresAtMs: nowMs + parsed.expires_in * 1000,
  };
  kickTokenCache.set(clientId, entry);
  return entry;
}

export async function fetchKickPublicKey(
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
  nowMs = Date.now(),
): Promise<string> {
  if (cachedKickPublicKey && cachedKickPublicKey.expiresAtMs > nowMs) {
    return cachedKickPublicKey.publicKey;
  }

  const res = await fetchFn(`${KICK_API_ORIGIN}/public-key`, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw AppError.internal(`Kick public-key endpoint error (${res.status})`);
  }

  const parsed = kickPublicKeyResponseSchema.parse(await res.json());
  cachedKickPublicKey = {
    publicKey: parsed.data.public_key,
    expiresAtMs: nowMs + 60 * 60_000,
  };
  return parsed.data.public_key;
}

const kickChannelsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        broadcaster_user_id: z.union([z.number().int(), z.string().min(1)]),
        slug: z.string().min(1),
        channel_description: z.string().optional(),
        banner_picture: z.string().optional(),
        stream: z
          .object({
            is_live: z.boolean().optional(),
            viewer_count: z.number().int().nonnegative().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

const kickLivestreamsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        broadcaster_user_id: z.union([z.number().int(), z.string().min(1)]),
        slug: z.string().min(1),
        stream_title: z.string().optional(),
        viewer_count: z.number().int().nonnegative(),
        started_at: z.string().optional(),
      }),
    )
    .default([]),
});

export interface KickProviderOptions {
  readonly accessToken: string;
  readonly fetchFn?: FetchLike;
  readonly quota?: TokenBucketQuotaGovernor;
}

/**
 * Official Kick Public API v1 adapter.
 * Zero scraping or undocumented endpoints: `/public/v1/` has no clips or VODs endpoint.
 */
export class KickProvider implements Provider {
  readonly platform = 'kick' as const;
  private readonly accessToken: string;
  private readonly fetchFn: FetchLike;
  private readonly quota: TokenBucketQuotaGovernor;

  constructor(options: KickProviderOptions) {
    this.accessToken = options.accessToken;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.quota = options.quota ?? new TokenBucketQuotaGovernor();
  }

  private async getJson<T>(
    path: string,
    params: ReadonlyArray<readonly [string, string]>,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    if (!this.quota.consume('kick', 1)) {
      throw AppError.rateLimited('Kick quota governor exhausted or circuit open');
    }
    const url = new URL(`${KICK_API_ORIGIN}/${path}`);
    for (const [k, v] of params) {
      url.searchParams.append(k, v);
    }

    const res = await this.fetchFn(url.toString(), {
      method: 'GET',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '0');
      this.quota.recordRateLimit('kick', Number.isFinite(retryAfter) ? retryAfter : undefined);
      throw AppError.rateLimited('Kick Public API rate limited (429)');
    }
    if (!res.ok) {
      throw AppError.internal(`Kick Public API error (${res.status})`);
    }
    const raw: unknown = await res.json();
    return schema.parse(raw);
  }

  async fetchChannel(externalIdOrHandle: string): Promise<ProviderChannel | null> {
    const trimmed = externalIdOrHandle.trim().toLowerCase();
    const paramKey = /^\d+$/.test(trimmed) ? 'broadcaster_user_id' : 'slug';
    const data = await this.getJson('channels', [[paramKey, trimmed]], kickChannelsResponseSchema);
    const ch = data.data[0];
    if (!ch) return null;

    return {
      platform: 'kick',
      externalId: String(ch.broadcaster_user_id),
      handle: ch.slug,
      displayName: ch.slug,
    };
  }

  async fetchRecentItems(_accountExternalId: string): Promise<readonly ProviderItem[]> {
    // Official Kick /public/v1/ exposes livestreams & channels only (no clips or VODs endpoint).
    return [];
  }

  async fetchStatsBatch(_externalIds: readonly string[]): Promise<readonly ProviderItemStats[]> {
    return [];
  }

  async fetchLiveStatus(
    accountExternalIds: readonly string[],
  ): Promise<readonly ProviderLiveStatus[]> {
    if (accountExternalIds.length === 0) return [];
    const params = accountExternalIds
      .slice(0, 50)
      .map((id) => ['broadcaster_user_id', id] as const);
    const data = await this.getJson('livestreams', params, kickLivestreamsResponseSchema);

    const byBroadcaster = new Map(
      data.data.map((stream) => [String(stream.broadcaster_user_id), stream]),
    );

    return accountExternalIds.map((id) => {
      const stream = byBroadcaster.get(id);
      if (!stream) {
        return { accountExternalId: id, isLive: false };
      }
      return {
        accountExternalId: id,
        isLive: true,
        streamExternalId: `kick-live-${id}-${stream.started_at ?? 'active'}`,
        title: stream.stream_title,
        viewers: stream.viewer_count,
        startedAt: stream.started_at,
      };
    });
  }
}
