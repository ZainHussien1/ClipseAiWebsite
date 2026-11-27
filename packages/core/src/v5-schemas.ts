import { z } from 'zod';
import { itemKindSchema } from './providers/ingest-types.js';
import { platformSchema } from './types.js';

export const risingTierSchema = z.enum(['none', 'rising', 'breakout', 'viral']);
export type RisingTier = z.infer<typeof risingTierSchema>;

export const sourceRuleSchema = z.object({
  minRisingLevel: risingTierSchema.exclude(['none']).default('rising'),
  notifyLive: z.boolean().default(true),
  notifyUploads: z.boolean().default(true),
  muted: z.boolean().default(false),
});
export type SourceRule = z.infer<typeof sourceRuleSchema>;

export const dailyReportMemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  claimsCount: z.number().int().nonnegative(),
  clippedCount: z.number().int().nonnegative(),
  clipsLoggedCount: z.number().int().nonnegative(),
});
export type DailyReportMember = z.infer<typeof dailyReportMemberSchema>;

// ============================================================================
// V5: Creators Intelligence
// ============================================================================

export const creatorBaselineSchema = z.object({
  kind: itemKindSchema,
  medianViews: z.number().nonnegative().nullable(),
  sampleSize: z.number().int().nonnegative(),
  requiredSamples: z.number().int().positive(),
  status: z.enum(['ready', 'collecting']),
});
export type CreatorBaseline = z.infer<typeof creatorBaselineSchema>;

export const creatorHeatmapBucketSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  hourUtc: z.number().int().min(0).max(23),
  count: z.number().int().nonnegative(),
});
export type CreatorHeatmapBucket = z.infer<typeof creatorHeatmapBucketSchema>;

export const creatorCadenceSchema = z.object({
  observedEvents: z.number().int().nonnegative(),
  sampleFloor: z.number().int().positive(),
  ready: z.boolean(),
  summaryLabel: z.string(),
  avgPerWeek: z.number().nonnegative().nullable(),
  heatmap: z.array(creatorHeatmapBucketSchema),
});
export type CreatorCadence = z.infer<typeof creatorCadenceSchema>;

export const creatorTeamRoiSchema = z.object({
  claimsCount: z.number().int().nonnegative(),
  clipsCount: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1).nullable(),
  medianClipViews: z.number().nonnegative().nullable(),
  medianTimeToClipMs: z.number().nonnegative().nullable(),
  totalManualRevenueCents: z.number().int().nonnegative(),
  sampleFloor: z.number().int().positive(),
});
export type CreatorTeamRoi = z.infer<typeof creatorTeamRoiSchema>;

export const creatorSubscriptionHealthSchema = z.object({
  topic: z.string(),
  status: z.enum(['pending', 'active', 'revoked', 'expired', 'none']),
  leaseExpiresAt: z.string().nullable(),
});
export type CreatorSubscriptionHealth = z.infer<typeof creatorSubscriptionHealthSchema>;

export const creatorLaneCountsSchema = z.object({
  videos: z.number().int().nonnegative(),
  shorts: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  unclassified: z.number().int().nonnegative(),
});

export const creatorLaneItemSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  accountHandle: z.string(),
  accountDisplayName: z.string(),
  platform: platformSchema,
  externalId: z.string(),
  kind: itemKindSchema,
  shortsClassification: z.enum(['video', 'short', 'live', 'unclassified']).nullable(),
  title: z.string(),
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  publishedAt: z.string(),
  firstSeenAt: z.string(),
  isBackfill: z.boolean(),
  durationSec: z.number().int().nonnegative().nullable(),
  latestViews: z.number().int().nonnegative().nullable(),
  latestLikes: z.number().int().nonnegative().nullable(),
  latestComments: z.number().int().nonnegative().nullable(),
  risingScore: z.number().nullable(),
  risingTier: risingTierSchema.exclude(['none']).nullable(),
  risingReason: z.string().nullable(),
  claimStatus: z.string().nullable(),
  source: z.string(),
  ageSeconds: z.number().int().nonnegative(),
});
export type CreatorLaneItem = z.infer<typeof creatorLaneItemSchema>;

export const creatorSummarySchema = z.object({
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
  laneCounts: creatorLaneCountsSchema,
  baselines: z.array(creatorBaselineSchema),
  observedEvents: z.number().int().nonnegative(),
  cadenceSummary: z.string(),
  notesPreview: z.string().nullable(),
  subscriptionHealth: creatorSubscriptionHealthSchema,
  teamRoi: creatorTeamRoiSchema,
});
export type CreatorSummary = z.infer<typeof creatorSummarySchema>;

export const creatorsListResponseSchema = z.object({
  creators: z.array(creatorSummarySchema),
  source: z.string(),
  asOf: z.string(),
});
export type CreatorsListResponse = z.infer<typeof creatorsListResponseSchema>;

export const creatorDetailSchema = z.object({
  creator: creatorSummarySchema,
  itemsByLane: z.object({
    videos: z.array(creatorLaneItemSchema),
    shorts: z.array(creatorLaneItemSchema),
    live: z.array(creatorLaneItemSchema),
    unclassified: z.array(creatorLaneItemSchema),
  }),
  cadence: creatorCadenceSchema,
  notes: z.object({
    body: z.string(),
    updatedAt: z.string().nullable(),
    updatedByEmail: z.string().nullable(),
  }),
  source: z.string(),
  asOf: z.string(),
});
export type CreatorDetail = z.infer<typeof creatorDetailSchema>;

export const updateCreatorNotesSchema = z.object({
  body: z.string().trim().max(4000),
});
export type UpdateCreatorNotesInput = z.infer<typeof updateCreatorNotesSchema>;

// ============================================================================
// V5: Reports (Weekly + AI Insights Narrative)
// ============================================================================

export const aiNarrativeStatusSchema = z.enum([
  'off',
  'used',
  'fallback_no_key',
  'fallback_disabled',
  'fallback_ungrounded',
  'fallback_error',
]);
export type AiNarrativeStatus = z.infer<typeof aiNarrativeStatusSchema>;

export const weeklyReportDaySchema = z.object({
  date: z.string(),
  alertsCount: z.number().int().nonnegative(),
  claimsCount: z.number().int().nonnegative(),
  clippedCount: z.number().int().nonnegative(),
  clipsLoggedCount: z.number().int().nonnegative(),
});
export type WeeklyReportDay = z.infer<typeof weeklyReportDaySchema>;

export const weeklyReportSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  timezone: z.string(),
  teamSummary: z.object({
    alertsCount: z.number().int().nonnegative(),
    claimsCount: z.number().int().nonnegative(),
    clippedCount: z.number().int().nonnegative(),
    clipsLoggedCount: z.number().int().nonnegative(),
    manualRevenueCents: z.number().int().nonnegative(),
  }),
  days: z.array(weeklyReportDaySchema),
  members: z.array(dailyReportMemberSchema),
  source: z.string(),
  asOf: z.string(),
});
export type WeeklyReportData = z.infer<typeof weeklyReportSchema>;

// ============================================================================
// V5: Clip Log Picker & Member Invites
// ============================================================================

export const sourceItemPickerSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  creatorName: z.string(),
  creatorHandle: z.string(),
  platform: platformSchema,
  url: z.string(),
  publishedAt: z.string(),
});
export type SourceItemPickerEntry = z.infer<typeof sourceItemPickerSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(['Owner', 'Admin', 'Member', 'Viewer']).default('Member'),
  temporaryPassphrase: z.string().min(8).max(128),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const inviteMemberResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  maxSeats: z.number().int().positive(),
  seatsUsed: z.number().int().nonnegative(),
});
export type InviteMemberResponse = z.infer<typeof inviteMemberResponseSchema>;

// ============================================================================
// V5: Admin Health, DLQ Retry, Audit Log, Data Quality
// ============================================================================

export const dlqItemSchema = z.object({
  id: z.string(),
  queueName: z.enum(['ingest-dlq', 'notify-dlq']),
  errorReason: z.string(),
  status: z.enum(['pending', 'retried', 'discarded']),
  attempts: z.number().int().nonnegative(),
  createdAt: z.string(),
  retriedAt: z.string().nullable(),
});
export type DlqItem = z.infer<typeof dlqItemSchema>;

export const adminHealthSchema = z.object({
  d1: z.object({
    readsTodayEstimate: z.number().int().nonnegative(),
    writesTodayEstimate: z.number().int().nonnegative(),
    dailyReadLimit: z.number().int().positive(),
    dailyWriteLimit: z.number().int().positive(),
    degraded: z.boolean(),
  }),
  queues: z.object({
    ingestQueueDepth: z.number().int().nonnegative(),
    notifyQueueDepth: z.number().int().nonnegative(),
    ingestDlqCount: z.number().int().nonnegative(),
    notifyDlqCount: z.number().int().nonnegative(),
    dlqItems: z.array(dlqItemSchema),
  }),
  cron: z.object({
    lastRunAt: z.string().nullable(),
    lastSyncAt: z.string().nullable(),
    reconcileRunsToday: z.number().int().nonnegative(),
  }),
  delivery: z.object({
    deliveredCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    suppressedCount: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1).nullable(),
    recentErrors: z.array(
      z.object({
        id: z.string(),
        channel: z.string(),
        reason: z.string().nullable(),
        attemptedAt: z.string(),
      }),
    ),
  }),
  source: z.string(),
  asOf: z.string(),
});
export type AdminHealthData = z.infer<typeof adminHealthSchema>;

export const dlqRetrySchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  queueName: z.enum(['ingest-dlq', 'notify-dlq']).optional(),
});
export type DlqRetryInput = z.infer<typeof dlqRetrySchema>;

export const dlqRetryResponseSchema = z.object({
  ok: z.boolean(),
  retriedCount: z.number().int().nonnegative(),
  remainingPending: z.number().int().nonnegative(),
});
export type DlqRetryResponse = z.infer<typeof dlqRetryResponseSchema>;

export const auditLogQuerySchema = z.object({
  action: z.string().trim().min(1).max(64).optional(),
  actorUserId: z.string().trim().min(1).max(128).optional(),
  from: z.string().trim().min(1).max(64).optional(),
  to: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogEntrySchema = z.object({
  id: z.string(),
  actorUserId: z.string(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogResponseSchema = z.object({
  entries: z.array(auditLogEntrySchema),
  source: z.string(),
  asOf: z.string(),
});
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;

export const dataQualitySchema = z.object({
  counts: z.object({
    missingDuration: z.number().int().nonnegative(),
    unclassifiedShorts: z.number().int().nonnegative(),
    staleSources: z.number().int().nonnegative(),
    orphanClaims: z.number().int().nonnegative(),
  }),
  missingDuration: z.array(
    z.object({
      itemId: z.string(),
      title: z.string(),
      creatorName: z.string(),
      platform: platformSchema,
      publishedAt: z.string(),
    }),
  ),
  unclassifiedShorts: z.array(
    z.object({
      itemId: z.string(),
      title: z.string(),
      creatorName: z.string(),
      platform: platformSchema,
      publishedAt: z.string(),
    }),
  ),
  staleSources: z.array(
    z.object({
      followId: z.string(),
      accountId: z.string(),
      displayName: z.string(),
      handle: z.string(),
      platform: platformSchema,
      lastSyncedAt: z.string().nullable(),
    }),
  ),
  orphanClaims: z.array(
    z.object({
      claimId: z.string(),
      itemId: z.string(),
      title: z.string(),
      status: z.string(),
      userId: z.string(),
      createdAt: z.string(),
    }),
  ),
  source: z.string(),
  asOf: z.string(),
});
export type DataQualityReport = z.infer<typeof dataQualitySchema>;
