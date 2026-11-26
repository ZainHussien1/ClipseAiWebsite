export type Platform = 'youtube' | 'twitch' | 'kick';
export type ClipPlatform = Platform | 'tiktok' | 'instagram' | 'x';
export type ItemKind = 'video' | 'short' | 'live' | 'vod' | 'clip';
export type RisingTier = 'none' | 'rising' | 'breakout' | 'viral';
export type ActiveRisingTier = Exclude<RisingTier, 'none'>;
export type ClaimStatus = 'New' | 'Claimed' | 'Clipped' | 'Skipped';

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
  title: string;
  url: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  firstSeenAt: string;
  isBackfill: boolean;
  durationSec: number | null;
  ingestLatencyMs: number | null;
  latestViews: number | null;
  latestLikes: number | null;
  latestComments: number | null;
  snapshotCount: number;
  claimStatus: ClaimStatus | null;
  claim: ItemClaimInfo | null;
  source: string;
  ageSeconds: number;
}

export interface FeedResponse {
  items: FeedItem[];
  nextCursor: string | null;
  source: string;
  asOf: string;
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
  createdAt: string;
  updatedAt: string;
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

export interface NotificationPrefs {
  hourlyBudget: number;
  quietStartHour: number | null;
  quietEndHour: number | null;
  timezone: string;
  snoozeUntil: string | null;
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
  createdAt: string;
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

export interface DailyReportData {
  date: string;
  timezone: string;
  aiInsightsUsed: boolean;
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

export interface WorkspaceMember {
  userId: string;
  email: string;
  role: WorkspaceRole;
  createdAt?: string;
}
