export type Platform = 'youtube' | 'twitch' | 'kick';
export type ClipPlatform = Platform | 'tiktok' | 'instagram' | 'x';
export type ItemKind = 'video' | 'short' | 'live' | 'vod' | 'clip';
export type ShortsClassification = 'video' | 'short' | 'live' | 'unclassified';
export type RisingTier = 'none' | 'rising' | 'breakout' | 'viral';
export type ActiveRisingTier = Exclude<RisingTier, 'none'>;
export type ClaimStatus = 'New' | 'Claimed' | 'Clipping' | 'Clipped' | 'Published' | 'Skipped';

export type FeedLane = 'videos' | 'shorts' | 'live' | 'unclassified';
export type FeedSort = 'newest' | 'rising' | 'views';
export type FeedAge = '6h' | '24h' | '72h' | '7d';

export type AlertType = 'rising' | 'breakout' | 'viral' | 'live_moment' | 'vod_ready';
export type AlertConfidence = 'low' | 'medium' | 'high';
export type NotificationTier = 'P1' | 'P2' | 'P3';
export type NotificationChannel = 'discord' | 'webpush' | 'in_app';
export type WorkspaceRole = 'Owner' | 'Admin' | 'Member' | 'Viewer';

export interface ItemClaimInfo {
  id: string;
  status: ClaimStatus;
  userId: string;
  email: string | null;
  claimedByMe: boolean;
}

export interface SourceRule {
  minRisingLevel: ActiveRisingTier;
  notifyLive: boolean;
  notifyUploads: boolean;
  muted: boolean;
}

export interface SourceItem {
  followId: string;
  accountId: string;
  platform: Platform;
  externalId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  starred: boolean;
  isOwn: boolean;
  paused: boolean;
  archived: boolean;
  groupName: string | null;
  tags: string[];
  rules: SourceRule;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface FeedItem {
  id: string;
  accountId: string;
  accountHandle: string;
  accountDisplayName: string;
  platform: Platform;
  externalId: string;
  kind: ItemKind;
  shortsClassification: ShortsClassification | null;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  firstSeenAt: string;
  dayGroup: string;
  isBackfill: boolean;
  isSeen: boolean;
  durationSec: number | null;
  ingestLatencyMs: number | null;
  latestViews: number | null;
  latestLikes: number | null;
  latestComments: number | null;
  snapshotCount: number;
  risingScore: number | null;
  risingTier: ActiveRisingTier | null;
  risingReason: string | null;
  claimStatus: ClaimStatus | null;
  claim: ItemClaimInfo | null;
  source: string;
  ageSeconds: number;
}

export interface FeedCreatorRailItem {
  accountId: string;
  handle: string;
  displayName: string;
  platform: Platform;
  unseenCount: number;
  starred: boolean;
}

export interface LaneCounts {
  videos: number;
  shorts: number;
  live: number;
  unclassified: number;
}

export interface FeedResponse {
  items: FeedItem[];
  nextCursor: string | null;
  laneCounts: LaneCounts;
  creatorsRail: FeedCreatorRailItem[];
  source: string;
  asOf: string;
}

export interface ItemDetail {
  item: FeedItem;
  snapshots: Array<{
    capturedAt: string;
    views: number;
    likes: number | null;
    comments: number | null;
  }>;
  claims: ClaimRecord[];
  alerts: Array<{
    id: string;
    type: string;
    confidence: string;
    score: number;
    reason: string;
    createdAt: string;
  }>;
}

export interface SavedViewFilters {
  platform?: Platform;
  lane?: FeedLane;
  sort?: FeedSort;
  age?: FeedAge;
  minViews?: number;
  starredOnly?: boolean;
  unseenOnly?: boolean;
  accountId?: string;
  q?: string;
}

export interface SavedViewRecord {
  id: string;
  name: string;
  filters: SavedViewFilters;
  createdAt: string;
}

export interface LiveStream {
  itemId: string;
  accountId: string;
  accountHandle: string;
  accountDisplayName: string;
  platform: Platform;
  externalId: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  viewers: number;
  startedAt: string;
  sampledAt: string;
  source: string;
  ageSeconds: number;
}

export interface LiveResponse {
  streams: LiveStream[];
  liveCount: number;
  source: string;
  asOf: string;
}

export type PaceLabel =
  | 'Normal pace'
  | 'Rising'
  | 'Breakout'
  | 'Viral'
  | 'Unscored — collecting baseline';

export interface RisingItem {
  itemId: string;
  accountId: string;
  accountHandle: string;
  accountDisplayName: string;
  platform: Platform;
  externalId: string;
  kind: ItemKind;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  isBackfill: boolean;
  tier: ActiveRisingTier;
  paceLabel?: PaceLabel;
  baselineN?: number;
  baselineRequired?: number;
  score: number;
  velocityRatio: number;
  engagementRatio: number | null;
  reason: string;
  snapshotCount: number;
  snapshots?: number[];
  claim: ItemClaimInfo | null;
  source: string;
  ageSeconds: number;
}

export interface RisingResponse {
  items: RisingItem[];
  source: string;
  asOf: string;
}

export interface ClaimRecord {
  id: string;
  workspaceId: string;
  itemId: string;
  userId: string;
  startSec: number | null;
  endSec: number | null;
  status: ClaimStatus;
  note: string | null;
  clipUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkBoardClaim extends ClaimRecord {
  title: string;
  thumbnailUrl: string | null;
  creatorName: string;
  creatorHandle: string;
  platform: Platform;
  url: string;
  claimerEmail: string | null;
  clipUrl: string | null;
}

export interface HotUnclaimedItem {
  alertId: string;
  itemId: string;
  title: string;
  thumbnailUrl: string | null;
  creatorName: string;
  creatorHandle: string;
  platform: Platform;
  url: string;
  tier: ActiveRisingTier | 'live_moment' | 'vod_ready';
  score: number;
  reason: string;
  createdAt: string;
}

export interface WorkBoardResponse {
  claims: WorkBoardClaim[];
  hotUnclaimed: HotUnclaimedItem[];
  statuses: ClaimStatus[];
  source: string;
  asOf: string;
}

export interface MissionControlData {
  hasSources: boolean;
  hasItems: boolean;
  kpis: {
    newItems24h: {
      total: number;
      videos: number;
      shorts: number;
      live: number;
    };
    liveNowCount: number;
    hotUnclaimedCount: number;
    claimsInProgressCount: number;
    clipsTodayCount: number;
    medianTimeToAlertMs7d: number | null;
  };
  needsAttention: Array<{
    kind: 'unclaimed_alert' | 'stale_claim';
    alertId: string | null;
    claimId: string | null;
    itemId: string;
    title: string;
    creatorName: string;
    platform: Platform;
    reason: string;
    score: number | null;
    ageSeconds: number;
  }>;
  liveNowRail: LiveStream[];
  risingTop5: RisingItem[];
  teamActivity: Array<{
    id: string;
    actorEmail: string | null;
    action: string;
    targetType: string;
    targetId: string;
    summary: string;
    createdAt: string;
  }>;
  providerHealth: {
    youtube: { status: string; label: string };
    twitch: { status: string; label: string };
    kick: { status: string; label: string };
    lastIngestAt: string | null;
  };
  asOf: string;
}

export type AlertDeliveryStatus =
  | 'detected'
  | 'queued'
  | 'delivered'
  | 'suppressed'
  | 'failed';

export interface AlertDeliveryRecord {
  id: string;
  alertId: string | null;
  channel: string;
  status: AlertDeliveryStatus;
  reason: string | null;
  attemptedAt: string;
  deliveredAt: string | null;
}

export interface AlertItem {
  id: string;
  itemId: string;
  accountHandle: string;
  accountDisplayName: string;
  platform: Platform;
  title: string;
  url: string;
  type: AlertType;
  confidence: AlertConfidence;
  score: number;
  reason: string;
  evidence: Record<string, unknown>;
  userVote: boolean | null;
  remindedAt: string | null;
  acknowledgedAt?: string | null;
  claimedBy?: string | null;
  deliveries?: AlertDeliveryRecord[];
  createdAt: string;
  source: string;
  ageSeconds: number;
}

export interface NotificationRecord {
  id: string;
  workspaceId: string;
  userId: string;
  alertId: string | null;
  tier: NotificationTier;
  channel: NotificationChannel;
  title: string;
  body: string;
  readAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export type AlertRulesMap = Record<
  AlertType,
  { tier: NotificationTier; channels: NotificationChannel[] }
>;

export interface NotificationPrefs {
  hourlyBudget: number;
  quietStartHour: number | null;
  quietEndHour: number | null;
  timezone: string;
  snoozeUntil: string | null;
  discordDailyDigest?: boolean;
  rules?: AlertRulesMap;
}

export interface MemberAvailabilityWindow {
  day: number;
  startHour: number;
  endHour: number;
  enabled: boolean;
}

export interface MemberAvailability {
  timezone: string;
  schedule: MemberAvailabilityWindow[];
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface ClipRecord {
  id: string;
  workspaceId: string;
  claimId: string | null;
  sourceItemId: string | null;
  userId: string | null;
  url: string;
  platform: ClipPlatform;
  title: string | null;
  needsConfirmation: boolean;
  statsSource: 'api' | 'manual' | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  statsCapturedAt: string | null;
  manualRevenueCents?: number | null;
  revenueSource?: 'manual' | null;
  publishTime?: string | null;
  sourceItemTitle?: string | null;
  sourceCreatorName?: string | null;
  createdAt: string;
}

export interface SourceItemPickerEntry {
  itemId: string;
  title: string;
  creatorName: string;
  creatorHandle: string;
  platform: Platform;
  url: string;
  publishedAt: string;
}

export interface SourceRoiEntry {
  accountId: string;
  handle: string;
  displayName: string;
  platform: Platform;
  claimsCount: number;
  clipsCount: number;
  totalClipViews: number;
  sampleFloor: number;
  status: 'ready' | 'not enough data yet';
  clipsPerClaim: number | null;
}

export interface ScorecardMetric {
  precision: number | null;
  sampleSize: number;
  sampleFloor: number;
  status: 'ready' | 'not enough data yet';
}

export interface ScorecardData {
  rising: ScorecardMetric;
  liveMoments: ScorecardMetric;
  avgTimeToAlertMs: number | null;
  missedPushRate: number | null;
  alertToClaimRate: number | null;
  telemetry: {
    pushesReceived: number;
    missedPushes: number;
    reconcileRuns: number;
  };
  source: string;
  asOf: string;
}

export interface DailyReportMember {
  userId: string;
  email: string;
  claimsCount: number;
  clippedCount: number;
  clipsLoggedCount: number;
}

export type AiNarrativeStatus =
  | 'off'
  | 'used'
  | 'fallback_no_key'
  | 'fallback_disabled'
  | 'fallback_ungrounded'
  | 'fallback_error';

export interface DailyReportData {
  date: string;
  timezone: string;
  aiInsightsUsed: boolean;
  aiStatus?: AiNarrativeStatus;
  narrative?: string;
  fallbackReason?: string | null;
  teamSummary: {
    alertsCount: number;
    claimsCount: number;
    clippedCount: number;
    clipsLoggedCount: number;
  };
  members: DailyReportMember[];
  source: string;
  asOf: string;
}

export interface WeeklyReportDay {
  date: string;
  alertsCount: number;
  claimsCount: number;
  clippedCount: number;
  clipsLoggedCount: number;
}

export interface WeeklyReportData {
  startDate: string;
  endDate: string;
  timezone: string;
  teamSummary: {
    alertsCount: number;
    claimsCount: number;
    clippedCount: number;
    clipsLoggedCount: number;
    manualRevenueCents: number;
  };
  days: WeeklyReportDay[];
  members: DailyReportMember[];
  source: string;
  asOf: string;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  role: WorkspaceRole;
  createdAt?: string;
}

export type IntegrationStatus =
  | 'not_configured'
  | 'verifying'
  | 'healthy'
  | 'degraded'
  | 'failing';

export interface IntegrationDetail {
  platform: Platform;
  status: IntegrationStatus;
  mode: string;
  secretPresence: Record<string, boolean>;
  quotaUsedToday: number;
  quotaLimitDaily: number;
  subscriptionCount: number;
  nextLeaseRenewalAt: string | null;
  callbackUrls: {
    webhookUrl: string;
    oauthCallbackUrl: string | null;
  };
  setupSteps: string[];
}

export interface IntegrationsResponse {
  integrations: IntegrationDetail[];
  extraSecrets: Record<string, boolean>;
  source: string;
  asOf: string;
}

export interface IntegrationVerifyResponse {
  ok: boolean;
  platform: Platform;
  status: IntegrationStatus;
  message: string;
  checkedAt: string;
}

export interface CreatorBaseline {
  kind: ItemKind;
  medianViews: number | null;
  sampleSize: number;
  requiredSamples: number;
  status: 'ready' | 'collecting';
}

export interface CreatorHeatmapBucket {
  dayOfWeek: number;
  hourUtc: number;
  count: number;
}

export interface CreatorCadence {
  observedEvents: number;
  sampleFloor: number;
  ready: boolean;
  summaryLabel: string;
  avgPerWeek: number | null;
  heatmap: CreatorHeatmapBucket[];
}

export interface CreatorTeamRoi {
  claimsCount: number;
  clipsCount: number;
  hitRate: number | null;
  medianClipViews: number | null;
  medianTimeToClipMs: number | null;
  totalManualRevenueCents: number;
  sampleFloor: number;
}

export interface CreatorSubscriptionHealth {
  topic: string;
  status: 'pending' | 'active' | 'revoked' | 'expired' | 'none';
  leaseExpiresAt: string | null;
}

export interface CreatorLaneItem {
  id: string;
  accountId: string;
  accountHandle: string;
  accountDisplayName: string;
  platform: Platform;
  externalId: string;
  kind: ItemKind;
  shortsClassification: ShortsClassification | null;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  firstSeenAt: string;
  isBackfill: boolean;
  durationSec: number | null;
  latestViews: number | null;
  latestLikes: number | null;
  latestComments: number | null;
  risingScore: number | null;
  risingTier: ActiveRisingTier | null;
  risingReason: string | null;
  claimStatus: string | null;
  source: string;
  ageSeconds: number;
}

export interface CreatorSummary {
  followId: string;
  accountId: string;
  platform: Platform;
  externalId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  starred: boolean;
  isOwn: boolean;
  paused: boolean;
  archived: boolean;
  groupName: string | null;
  tags: string[];
  rules: SourceRule;
  lastSyncedAt: string | null;
  laneCounts: LaneCounts;
  baselines: CreatorBaseline[];
  observedEvents: number;
  cadenceSummary: string;
  notesPreview: string | null;
  subscriptionHealth: CreatorSubscriptionHealth;
  teamRoi: CreatorTeamRoi;
}

export interface CreatorsListResponse {
  creators: CreatorSummary[];
  source: string;
  asOf: string;
}

export interface CreatorDetail {
  creator: CreatorSummary;
  itemsByLane: {
    videos: CreatorLaneItem[];
    shorts: CreatorLaneItem[];
    live: CreatorLaneItem[];
    unclassified: CreatorLaneItem[];
  };
  cadence: CreatorCadence;
  notes: {
    body: string;
    updatedAt: string | null;
    updatedByEmail: string | null;
  };
  source: string;
  asOf: string;
}

export interface InviteMemberResponse {
  ok: boolean;
  message: string;
  maxSeats: number;
  seatsUsed: number;
}

export interface DlqItem {
  id: string;
  queueName: 'ingest-dlq' | 'notify-dlq';
  errorReason: string;
  status: 'pending' | 'retried' | 'discarded';
  attempts: number;
  createdAt: string;
  retriedAt: string | null;
}

export interface AdminHealthData {
  d1: {
    readsTodayEstimate: number;
    writesTodayEstimate: number;
    dailyReadLimit: number;
    dailyWriteLimit: number;
    degraded: boolean;
  };
  queues: {
    ingestQueueDepth: number;
    notifyQueueDepth: number;
    ingestDlqCount: number;
    notifyDlqCount: number;
    dlqItems: DlqItem[];
  };
  cron: {
    lastRunAt: string | null;
    lastSyncAt: string | null;
    reconcileRunsToday: number;
  };
  delivery: {
    deliveredCount: number;
    failedCount: number;
    suppressedCount: number;
    successRate: number | null;
    recentErrors: Array<{
      id: string;
      channel: string;
      reason: string | null;
      attemptedAt: string;
    }>;
  };
  source: string;
  asOf: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  source: string;
  asOf: string;
}

export interface DataQualityReport {
  counts: {
    missingDuration: number;
    unclassifiedShorts: number;
    staleSources: number;
    orphanClaims: number;
  };
  missingDuration: Array<{
    itemId: string;
    title: string;
    creatorName: string;
    platform: Platform;
    publishedAt: string;
  }>;
  unclassifiedShorts: Array<{
    itemId: string;
    title: string;
    creatorName: string;
    platform: Platform;
    publishedAt: string;
  }>;
  staleSources: Array<{
    followId: string;
    accountId: string;
    displayName: string;
    handle: string;
    platform: Platform;
    lastSyncedAt: string | null;
  }>;
  orphanClaims: Array<{
    claimId: string;
    itemId: string;
    title: string;
    status: string;
    userId: string;
    createdAt: string;
  }>;
  source: string;
  asOf: string;
}
