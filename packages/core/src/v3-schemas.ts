import { z } from 'zod';
import {
  claimRecordSchema,
  claimStatusSchema,
  feedItemSchema,
  liveStreamSchema,
  risingItemSchema,
  risingTierSchema,
} from './api-schemas.js';
import { platformSchema } from './types.js';

export const feedLaneSchema = z.enum(['videos', 'shorts', 'live', 'unclassified']);
export type FeedLane = z.infer<typeof feedLaneSchema>;

export const feedSortSchema = z.enum(['newest', 'rising', 'views']);
export type FeedSort = z.infer<typeof feedSortSchema>;

export const feedAgeSchema = z.enum(['6h', '24h', '72h', '7d']);
export type FeedAge = z.infer<typeof feedAgeSchema>;

export const feedCreatorRailItemSchema = z.object({
  accountId: z.string(),
  handle: z.string(),
  displayName: z.string(),
  platform: platformSchema,
  unseenCount: z.number().int().nonnegative(),
  starred: z.boolean(),
});
export type FeedCreatorRailItem = z.infer<typeof feedCreatorRailItemSchema>;

export const laneCountsSchema = z.object({
  videos: z.number().int().nonnegative(),
  shorts: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  unclassified: z.number().int().nonnegative(),
});
export type LaneCounts = z.infer<typeof laneCountsSchema>;

export const itemDetailSchema = z.object({
  item: feedItemSchema,
  snapshots: z.array(
    z.object({
      capturedAt: z.string(),
      views: z.number().int().nonnegative(),
      likes: z.number().int().nonnegative().nullable(),
      comments: z.number().int().nonnegative().nullable(),
    }),
  ),
  claims: z.array(claimRecordSchema),
  alerts: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      confidence: z.string(),
      score: z.number(),
      reason: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export type ItemDetail = z.infer<typeof itemDetailSchema>;

export const savedViewFiltersSchema = z.object({
  platform: platformSchema.optional(),
  lane: feedLaneSchema.optional(),
  sort: feedSortSchema.optional(),
  age: feedAgeSchema.optional(),
  minViews: z.number().int().nonnegative().optional(),
  starredOnly: z.boolean().optional(),
  unseenOnly: z.boolean().optional(),
  accountId: z.string().optional(),
  q: z.string().optional(),
});
export type SavedViewFilters = z.infer<typeof savedViewFiltersSchema>;

export const createSavedViewSchema = z.object({
  name: z.string().trim().min(1).max(60),
  filters: savedViewFiltersSchema,
});
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;

export const savedViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  filters: savedViewFiltersSchema,
  createdAt: z.string(),
});
export type SavedViewRecord = z.infer<typeof savedViewSchema>;

export const markSeenSchema = z
  .object({
    itemIds: z.array(z.string().min(1).max(128)).min(1).max(200).optional(),
    accountId: z.string().min(1).max(128).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.itemIds?.length || v.accountId || v.all), {
    message: 'Provide itemIds, accountId, or all: true',
  });
export type MarkSeenInput = z.infer<typeof markSeenSchema>;

export const missionControlSchema = z.object({
  hasSources: z.boolean(),
  hasItems: z.boolean(),
  kpis: z.object({
    newItems24h: z.object({
      total: z.number().int().nonnegative(),
      videos: z.number().int().nonnegative(),
      shorts: z.number().int().nonnegative(),
      live: z.number().int().nonnegative(),
    }),
    liveNowCount: z.number().int().nonnegative(),
    hotUnclaimedCount: z.number().int().nonnegative(),
    claimsInProgressCount: z.number().int().nonnegative(),
    clipsTodayCount: z.number().int().nonnegative(),
    medianTimeToAlertMs7d: z.number().int().nonnegative().nullable(),
  }),
  needsAttention: z.array(
    z.object({
      kind: z.enum(['unclaimed_alert', 'stale_claim']),
      alertId: z.string().nullable(),
      claimId: z.string().nullable(),
      itemId: z.string(),
      title: z.string(),
      creatorName: z.string(),
      platform: platformSchema,
      reason: z.string(),
      score: z.number().nullable(),
      ageSeconds: z.number().int().nonnegative(),
    }),
  ),
  liveNowRail: z.array(liveStreamSchema),
  risingTop5: z.array(risingItemSchema),
  teamActivity: z.array(
    z.object({
      id: z.string(),
      actorEmail: z.string().nullable(),
      action: z.string(),
      targetType: z.string(),
      targetId: z.string(),
      summary: z.string(),
      createdAt: z.string(),
    }),
  ),
  providerHealth: z.object({
    youtube: z.object({ status: z.string(), label: z.string() }),
    twitch: z.object({ status: z.string(), label: z.string() }),
    kick: z.object({ status: z.string(), label: z.string() }),
    lastIngestAt: z.string().nullable(),
  }),
  asOf: z.string(),
});
export type MissionControlData = z.infer<typeof missionControlSchema>;

export const workBoardClaimSchema = claimRecordSchema.extend({
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  creatorName: z.string(),
  creatorHandle: z.string(),
  platform: platformSchema,
  url: z.string(),
  claimerEmail: z.string().nullable(),
  clipUrl: z.string().nullable(),
});
export type WorkBoardClaim = z.infer<typeof workBoardClaimSchema>;

export const hotUnclaimedItemSchema = z.object({
  alertId: z.string(),
  itemId: z.string(),
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  creatorName: z.string(),
  creatorHandle: z.string(),
  platform: platformSchema,
  url: z.string(),
  tier: risingTierSchema.exclude(['none']).or(z.enum(['live_moment', 'vod_ready'])),
  score: z.number(),
  reason: z.string(),
  createdAt: z.string(),
});
export type HotUnclaimedItem = z.infer<typeof hotUnclaimedItemSchema>;

export const workBoardResponseSchema = z.object({
  claims: z.array(workBoardClaimSchema),
  hotUnclaimed: z.array(hotUnclaimedItemSchema),
  statuses: z.array(claimStatusSchema),
  source: z.string(),
  asOf: z.string(),
});
export type WorkBoardResponse = z.infer<typeof workBoardResponseSchema>;
