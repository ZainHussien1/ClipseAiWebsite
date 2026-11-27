import { z } from 'zod';
import { itemKindSchema } from './providers/ingest-types.js';
import { platformSchema } from './types.js';

export const risingTierSchema = z.enum(['none', 'rising', 'breakout', 'viral']);
export type RisingTier = z.infer<typeof risingTierSchema>;

export const claimStatusSchema = z.enum([
  'New',
  'Claimed',
  'Clipping',
  'Clipped',
  'Published',
  'Skipped',
]);
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
  lane: z.enum(['videos', 'shorts', 'live', 'unclassified']).optional(),
  sort: z.enum(['newest', 'rising', 'views']).optional().default('newest'),
  age: z.enum(['6h', '24h', '72h', '7d']).optional(),
  minViews: z.coerce.number().int().nonnegative().optional(),
  unseenOnly: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  accountId: z.string().trim().min(1).max(128).optional(),
  starredOnly: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  q: z.string().trim().min(1).max(120).optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const itemClaimInfoSchema = z.object({
  id: z.string(),
  status: claimStatusSchema,
  userId: z.string(),
  email: z.string().nullable(),
  claimedByMe: z.boolean(),
});
export type ItemClaimInfo = z.infer<typeof itemClaimInfoSchema>;

export const feedItemSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  accountHandle: z.string(),
  accountDisplayName: z.string(),
  platform: platformSchema,
  externalId: z.string(),
  kind: itemKindSchema,
  shortsClassification: z
    .enum(['video', 'short', 'live', 'unclassified'])
    .nullable(),
  title: z.string(),
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  publishedAt: z.string(),
  firstSeenAt: z.string(),
  dayGroup: z.string(),
  isBackfill: z.boolean(),
  isSeen: z.boolean(),
  durationSec: z.number().int().nonnegative().nullable(),
  ingestLatencyMs: z.number().int().nonnegative().nullable(),
  latestViews: z.number().int().nonnegative().nullable(),
  latestLikes: z.number().int().nonnegative().nullable(),
  latestComments: z.number().int().nonnegative().nullable(),
  snapshotCount: z.number().int().nonnegative(),
  risingScore: z.number().nullable(),
  risingTier: risingTierSchema.exclude(['none']).nullable(),
  risingReason: z.string().nullable(),
  claimStatus: claimStatusSchema.nullable(),
  claim: itemClaimInfoSchema.nullable(),
  source: z.string(),
  ageSeconds: z.number().int().nonnegative(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedResponseSchema = z.object({
  items: z.array(feedItemSchema),
  nextCursor: z.string().nullable(),
  laneCounts: z.object({
    videos: z.number().int().nonnegative(),
    shorts: z.number().int().nonnegative(),
    live: z.number().int().nonnegative(),
    unclassified: z.number().int().nonnegative(),
  }),
  creatorsRail: z.array(
    z.object({
      accountId: z.string(),
      handle: z.string(),
      displayName: z.string(),
      platform: platformSchema,
      unseenCount: z.number().int().nonnegative(),
      starred: z.boolean(),
    }),
  ),
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
  liveCount: z.number().int().nonnegative(),
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
  isBackfill: z.boolean(),
  tier: risingTierSchema.exclude(['none']),
  paceLabel: z
    .enum([
      'Normal pace',
      'Rising',
      'Breakout',
      'Viral',
      'Unscored — collecting baseline',
    ])
    .optional(),
  baselineN: z.number().int().nonnegative().optional(),
  baselineRequired: z.number().int().positive().optional(),
  score: z.number(),
  velocityRatio: z.number(),
  engagementRatio: z.number().nullable(),
  reason: z.string(),
  snapshotCount: z.number().int().nonnegative(),
  snapshots: z.array(z.number().nonnegative()).optional(),
  claim: itemClaimInfoSchema.nullable(),
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
  clipUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('https://'), {
      message: 'Clip URL must use https://',
    })
    .nullable()
    .optional(),
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
  clipUrl: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClaimRecord = z.infer<typeof claimRecordSchema>;

// ============================================================================
// Phase 4: Alerts, Votes, Notifications, Preferences, Push & Discord
// ============================================================================

export const alertTypeSchema = z.enum([
  'rising',
  'breakout',
  'viral',
  'live_moment',
  'vod_ready',
]);
export type AlertType = z.infer<typeof alertTypeSchema>;

export const alertConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type AlertConfidence = z.infer<typeof alertConfidenceSchema>;

export const alertVoteSchema = z.object({
  useful: z.boolean(),
});
export type AlertVoteInput = z.infer<typeof alertVoteSchema>;

export const alertItemSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  accountHandle: z.string(),
  accountDisplayName: z.string(),
  platform: platformSchema,
  title: z.string(),
  url: z.string(),
  type: alertTypeSchema,
  confidence: alertConfidenceSchema,
  score: z.number(),
  reason: z.string(),
  evidence: z.record(z.unknown()),
  userVote: z.boolean().nullable(),
  remindedAt: z.string().nullable(),
  acknowledgedAt: z.string().nullable().optional(),
  claimedBy: z.string().nullable().optional(),
  deliveries: z
    .array(
      z.object({
        id: z.string(),
        alertId: z.string().nullable(),
        channel: z.string(),
        status: z.enum(['detected', 'queued', 'delivered', 'suppressed', 'failed']),
        reason: z.string().nullable(),
        attemptedAt: z.string(),
        deliveredAt: z.string().nullable(),
      }),
    )
    .optional(),
  createdAt: z.string(),
  source: z.string(),
  ageSeconds: z.number().int().nonnegative(),
});
export type AlertItem = z.infer<typeof alertItemSchema>;

export const notificationTierSchema = z.enum(['P1', 'P2', 'P3']);
export type NotificationTier = z.infer<typeof notificationTierSchema>;

export const notificationChannelSchema = z.enum(['discord', 'webpush', 'in_app']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  alertId: z.string().nullable(),
  tier: notificationTierSchema,
  channel: notificationChannelSchema,
  title: z.string(),
  body: z.string(),
  readAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationRecord = z.infer<typeof notificationSchema>;

export const notificationPrefsSchema = z
  .object({
    hourlyBudget: z.number().int().min(1).max(100).default(10),
    quietStartHour: z.number().int().min(0).max(23).nullable().default(null),
    quietEndHour: z.number().int().min(0).max(23).nullable().default(null),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Must be a valid IANA timezone')
      .default('UTC'),
    snoozeUntil: z.string().datetime().nullable().default(null),
    discordDailyDigest: z.boolean().optional(),
    rules: z
      .record(
        z.enum(['rising', 'breakout', 'viral', 'live_moment', 'vod_ready']),
        z.object({
          tier: notificationTierSchema,
          channels: z.array(notificationChannelSchema),
        }),
      )
      .optional(),
  })
  .refine(
    (v) =>
      (v.quietStartHour === null && v.quietEndHour === null) ||
      (v.quietStartHour !== null && v.quietEndHour !== null),
    { message: 'Both quietStartHour and quietEndHour must be set or both null' },
  );
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('https://'), {
      message: 'Push endpoint must use https://',
    }),
  keys: z.object({
    p256dh: z.string().trim().min(16).max(256),
    auth: z.string().trim().min(8).max(128),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const DISCORD_WEBHOOK_REGEX =
  /^https:\/\/discord\.com\/api\/webhooks\/\d{10,30}\/[A-Za-z0-9._-]{20,128}$/;

export const discordWebhookConfigSchema = z.object({
  webhookUrl: z
    .string()
    .trim()
    .regex(
      DISCORD_WEBHOOK_REGEX,
      'Must be a valid https://discord.com/api/webhooks/{id}/{token} URL',
    )
    .nullable(),
});
export type DiscordWebhookConfigInput = z.infer<typeof discordWebhookConfigSchema>;

// ============================================================================
// Phase 5: Clip Log, Our Channels, ROI, Scorecard, Daily Report, Settings/Export
// ============================================================================

export const clipPlatformSchema = z.enum([
  'youtube',
  'twitch',
  'kick',
  'tiktok',
  'instagram',
  'x',
]);
export type ClipPlatform = z.infer<typeof clipPlatformSchema>;

export const manualClipStatsSchema = z.object({
  views: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
});
export type ManualClipStats = z.infer<typeof manualClipStatsSchema>;

export const createClipSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .refine((u) => u.startsWith('https://'), {
      message: 'Clip URL must use https://',
    }),
  platform: clipPlatformSchema,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  claimId: z.string().trim().min(1).max(128).optional(),
  sourceItemId: z.string().trim().min(1).max(128).optional(),
  manualStats: manualClipStatsSchema.optional(),
});
export type CreateClipInput = z.infer<typeof createClipSchema>;

export const confirmClipLinkSchema = z.object({
  sourceItemId: z.string().trim().min(1).max(128),
});
export type ConfirmClipLinkInput = z.infer<typeof confirmClipLinkSchema>;

export const clipRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  claimId: z.string().nullable(),
  sourceItemId: z.string().nullable(),
  userId: z.string().nullable(),
  url: z.string(),
  platform: clipPlatformSchema,
  title: z.string().nullable(),
  needsConfirmation: z.boolean(),
  statsSource: z.enum(['api', 'manual']).nullable(),
  views: z.number().int().nonnegative().nullable(),
  likes: z.number().int().nonnegative().nullable(),
  comments: z.number().int().nonnegative().nullable(),
  statsCapturedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ClipRecord = z.infer<typeof clipRecordSchema>;

export const sourceRoiSchema = z.object({
  accountId: z.string(),
  handle: z.string(),
  displayName: z.string(),
  platform: platformSchema,
  claimsCount: z.number().int().nonnegative(),
  clipsCount: z.number().int().nonnegative(),
  totalClipViews: z.number().int().nonnegative(),
  sampleFloor: z.number().int().positive(),
  status: z.enum(['ready', 'not enough data yet']),
  clipsPerClaim: z.number().nullable(),
});
export type SourceRoiEntry = z.infer<typeof sourceRoiSchema>;

export const scorecardMetricSchema = z.object({
  precision: z.number().nullable(),
  sampleSize: z.number().int().nonnegative(),
  sampleFloor: z.number().int().positive(),
  status: z.enum(['ready', 'not enough data yet']),
});

export const scorecardSchema = z.object({
  rising: scorecardMetricSchema,
  liveMoments: scorecardMetricSchema,
  avgTimeToAlertMs: z.number().nullable(),
  missedPushRate: z.number().nullable(),
  alertToClaimRate: z.number().nullable(),
  telemetry: z.object({
    pushesReceived: z.number().int().nonnegative(),
    missedPushes: z.number().int().nonnegative(),
    reconcileRuns: z.number().int().nonnegative(),
  }),
  source: z.string(),
  asOf: z.string(),
});
export type ScorecardData = z.infer<typeof scorecardSchema>;

export const dailyReportMemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  claimsCount: z.number().int().nonnegative(),
  clippedCount: z.number().int().nonnegative(),
  clipsLoggedCount: z.number().int().nonnegative(),
});

export const dailyReportSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  aiInsightsUsed: z.boolean(),
  teamSummary: z.object({
    alertsCount: z.number().int().nonnegative(),
    claimsCount: z.number().int().nonnegative(),
    clippedCount: z.number().int().nonnegative(),
    clipsLoggedCount: z.number().int().nonnegative(),
  }),
  members: z.array(dailyReportMemberSchema),
  source: z.string(),
  asOf: z.string(),
});
export type DailyReportData = z.infer<typeof dailyReportSchema>;

export const memberUpdateSchema = z.object({
  role: z.enum(['Owner', 'Admin', 'Member', 'Viewer']),
});
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

export const exportFormatSchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
});
export type ExportFormatInput = z.infer<typeof exportFormatSchema>;

export const requestCodeSchema = z.object({
  email: z.string().trim().email().max(254),
});
export type RequestCodeInput = z.infer<typeof requestCodeSchema>;

export const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    workspaceName: z.string().trim().min(1).max(80).optional(),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Verification code must be 6 digits')
      .optional(),
    passphrase: z.string().min(8).max(128).optional(),
  })
  .refine((v) => Boolean(v.code || v.passphrase), {
    message: 'Provide either a 6-digit verification code or a passphrase',
  });
export type LoginInput = z.infer<typeof loginSchema>;

export const setPassphraseSchema = z.object({
  passphrase: z.string().min(8).max(128),
});
export type SetPassphraseInput = z.infer<typeof setPassphraseSchema>;

// ============================================================================
// V2: Provider Integrations & Verification
// ============================================================================

export const integrationStatusSchema = z.enum([
  'not_configured',
  'verifying',
  'healthy',
  'degraded',
  'failing',
]);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const integrationDetailSchema = z.object({
  platform: platformSchema,
  status: integrationStatusSchema,
  mode: z.string(),
  secretPresence: z.record(z.boolean()),
  quotaUsedToday: z.number().int().nonnegative(),
  quotaLimitDaily: z.number().int().positive(),
  subscriptionCount: z.number().int().nonnegative(),
  nextLeaseRenewalAt: z.string().nullable(),
  callbackUrls: z.object({
    webhookUrl: z.string(),
    oauthCallbackUrl: z.string().nullable(),
  }),
  setupSteps: z.array(z.string()),
});
export type IntegrationDetail = z.infer<typeof integrationDetailSchema>;

export const integrationsResponseSchema = z.object({
  integrations: z.array(integrationDetailSchema),
  extraSecrets: z.record(z.boolean()),
  source: z.string(),
  asOf: z.string(),
});
export type IntegrationsResponse = z.infer<typeof integrationsResponseSchema>;

export const integrationVerifyResponseSchema = z.object({
  ok: z.boolean(),
  platform: platformSchema,
  status: integrationStatusSchema,
  message: z.string(),
  checkedAt: z.string(),
});
export type IntegrationVerifyResponse = z.infer<typeof integrationVerifyResponseSchema>;
