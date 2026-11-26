import { z } from 'zod';
import { itemKindSchema } from './providers/ingest-types.js';
import { platformSchema } from './types.js';

export const risingTierSchema = z.enum(['none', 'rising', 'breakout', 'viral']);
export type RisingTier = z.infer<typeof risingTierSchema>;

export const claimStatusSchema = z.enum(['New', 'Claimed', 'Clipped', 'Skipped']);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const sourceRuleSchema = z.object({
  minRisingLevel: risingTierSchema.exclude(['none']).default('rising'),
  notifyLive: z.boolean().default(true),
  notifyUploads: z.boolean().default(true),
  muted: z.boolean().default(false),
});
export type SourceRule = z.infer<typeof sourceRuleSchema>;

export const sourceTagSchema = z.string().trim().min(1).max(32);

export const createSourceSchema = z.object({
  input: z.string().trim().min(1).max(512),
  starred: z.boolean().optional().default(false),
  isOwn: z.boolean().optional().default(false),
  groupName: z.string().trim().min(1).max(64).optional(),
  tags: z.array(sourceTagSchema).max(10).optional().default([]),
  rules: sourceRuleSchema.partial().optional(),
});
export type CreateSourceInput = z.infer<typeof createSourceSchema>;

export const bulkCreateSourcesSchema = z
  .object({
    entries: z.array(createSourceSchema).min(1).max(200).optional(),
    rawLines: z.string().trim().min(1).max(65536).optional(),
    groupName: z.string().trim().min(1).max(64).optional(),
    tags: z.array(sourceTagSchema).max(10).optional().default([]),
    starred: z.boolean().optional().default(false),
  })
  .refine((v) => (v.entries && v.entries.length > 0) || Boolean(v.rawLines), {
    message: 'Provide either entries or rawLines',
  });
export type BulkCreateSourcesInput = z.infer<typeof bulkCreateSourcesSchema>;

export const updateSourceSchema = z.object({
  starred: z.boolean().optional(),
  paused: z.boolean().optional(),
  archived: z.boolean().optional(),
  groupName: z.string().trim().min(1).max(64).nullable().optional(),
  tags: z.array(sourceTagSchema).max(10).optional(),
  rules: sourceRuleSchema.partial().optional(),
});
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>;

export const sourceItemSchema = z.object({
  followId: z.string(),
  accountId: z.string(),
  platform: platformSchema,
  externalId: z.string(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  starred: z.boolean(),
  isOwn: z.boolean(),
  paused: z.boolean(),
  archived: z.boolean(),
  groupName: z.string().nullable(),
  tags: z.array(z.string()),
  rules: sourceRuleSchema,
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SourceItem = z.infer<typeof sourceItemSchema>;

export const feedQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  platform: platformSchema.optional(),
  kind: itemKindSchema.optional(),
  accountId: z.string().trim().min(1).max(128).optional(),
  starredOnly: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  q: z.string().trim().min(1).max(120).optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const feedItemSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  accountHandle: z.string(),
  accountDisplayName: z.string(),
  platform: platformSchema,
  externalId: z.string(),
  kind: itemKindSchema,
  title: z.string(),
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  publishedAt: z.string(),
  firstSeenAt: z.string(),
  ingestLatencyMs: z.number().int().nonnegative().nullable(),
  latestViews: z.number().int().nonnegative().nullable(),
  latestLikes: z.number().int().nonnegative().nullable(),
  latestComments: z.number().int().nonnegative().nullable(),
  claimStatus: claimStatusSchema.nullable(),
  source: z.string(),
  ageSeconds: z.number().int().nonnegative(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedResponseSchema = z.object({
  items: z.array(feedItemSchema),
  nextCursor: z.string().nullable(),
  source: z.string(),
  asOf: z.string(),
});
export type FeedResponse = z.infer<typeof feedResponseSchema>;

export const liveStreamSchema = z.object({
  itemId: z.string(),
  accountId: z.string(),
  accountHandle: z.string(),
  accountDisplayName: z.string(),
  platform: platformSchema,
  externalId: z.string(),
  title: z.string(),
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  viewers: z.number().int().nonnegative(),
  startedAt: z.string(),
  sampledAt: z.string(),
  source: z.string(),
  ageSeconds: z.number().int().nonnegative(),
});
export type LiveStream = z.infer<typeof liveStreamSchema>;

export const liveResponseSchema = z.object({
  streams: z.array(liveStreamSchema),
  source: z.string(),
  asOf: z.string(),
});
export type LiveResponse = z.infer<typeof liveResponseSchema>;

export const risingQuerySchema = z.object({
  tier: risingTierSchema.exclude(['none']).optional(),
  platform: platformSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type RisingQuery = z.infer<typeof risingQuerySchema>;

export const risingItemSchema = z.object({
  itemId: z.string(),
  accountId: z.string(),
  accountHandle: z.string(),
  accountDisplayName: z.string(),
  platform: platformSchema,
  externalId: z.string(),
  kind: itemKindSchema,
  title: z.string(),
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  publishedAt: z.string(),
  tier: risingTierSchema.exclude(['none']),
  score: z.number(),
  velocityRatio: z.number(),
  engagementRatio: z.number(),
  reason: z.string(),
  source: z.string(),
  ageSeconds: z.number().int().nonnegative(),
});
export type RisingItem = z.infer<typeof risingItemSchema>;

export const risingResponseSchema = z.object({
  items: z.array(risingItemSchema),
  source: z.string(),
  asOf: z.string(),
});
export type RisingResponse = z.infer<typeof risingResponseSchema>;

export const createClaimSchema = z
  .object({
    itemId: z.string().trim().min(1).max(128),
    startSec: z.number().int().nonnegative().optional(),
    endSec: z.number().int().positive().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) => v.endSec === undefined || v.startSec === undefined || v.endSec > v.startSec,
    { message: 'endSec must be greater than startSec' },
  );
export type CreateClaimInput = z.infer<typeof createClaimSchema>;

export const updateClaimSchema = z.object({
  status: claimStatusSchema,
  note: z.string().trim().max(500).nullable().optional(),
});
export type UpdateClaimInput = z.infer<typeof updateClaimSchema>;

export const claimRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  itemId: z.string(),
  userId: z.string(),
  startSec: z.number().int().nonnegative().nullable(),
  endSec: z.number().int().positive().nullable(),
  status: claimStatusSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClaimRecord = z.infer<typeof claimRecordSchema>;
