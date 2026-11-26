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
