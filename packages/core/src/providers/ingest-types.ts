import { z } from 'zod';
import { platformSchema } from '../types.js';

export const itemKindSchema = z.enum(['video', 'short', 'live', 'vod', 'clip']);

export const ingestSourceSchema = z.enum(['webhook', 'reconcile']);

export const ingestAccountPayloadSchema = z.object({
  platform: platformSchema,
  externalId: z.string().min(1).max(128),
  handle: z.string().min(1).max(128),
  displayName: z.string().min(1).max(256),
  avatarUrl: z.string().url().optional(),
});

export const ingestItemPayloadSchema = z.object({
  platform: platformSchema,
  externalId: z.string().min(1).max(128),
  accountExternalId: z.string().min(1).max(128),
  kind: itemKindSchema,
  title: z.string().min(1).max(500),
  url: z.string().url().refine((u) => u.startsWith('https://')),
  thumbnailUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'))
    .optional(),
  publishedAt: z.string().datetime({ offset: true }),
  isEdit: z.boolean().optional(),
  isBackfill: z.boolean().optional(),
  durationSec: z.number().int().nonnegative().optional(),
  shortsClassification: z.enum(['video', 'short', 'live', 'unclassified']).optional(),
});

export const ingestStatsPayloadSchema = z.object({
  platform: platformSchema,
  externalId: z.string().min(1).max(128),
  capturedAt: z.string().datetime({ offset: true }),
  views: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
});

export const ingestLiveSamplePayloadSchema = z.object({
  platform: platformSchema,
  streamExternalId: z.string().min(1).max(128),
  accountExternalId: z.string().min(1).max(128),
  title: z.string().min(1).max(500).optional(),
  sampledAt: z.string().datetime({ offset: true }),
  viewers: z.number().int().nonnegative(),
  isLive: z.boolean(),
});

export const ingestQueueMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('upsert_item'),
    idempotencyKey: z.string().min(1).max(256),
    source: ingestSourceSchema,
    receivedAt: z.string().datetime({ offset: true }),
    account: ingestAccountPayloadSchema.optional(),
    item: ingestItemPayloadSchema,
  }),
  z.object({
    type: z.literal('record_stats'),
    idempotencyKey: z.string().min(1).max(256),
    source: ingestSourceSchema,
    receivedAt: z.string().datetime({ offset: true }),
    stats: ingestStatsPayloadSchema,
  }),
  z.object({
    type: z.literal('record_live_sample'),
    idempotencyKey: z.string().min(1).max(256),
    source: ingestSourceSchema,
    receivedAt: z.string().datetime({ offset: true }),
    account: ingestAccountPayloadSchema.optional(),
    sample: ingestLiveSamplePayloadSchema,
  }),
]);

export type IngestQueueMessage = z.infer<typeof ingestQueueMessageSchema>;
