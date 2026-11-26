export type Platform = 'youtube' | 'twitch' | 'kick';
export type ItemKind = 'video' | 'short' | 'live' | 'vod' | 'clip';
export type RisingTier = 'none' | 'rising' | 'breakout' | 'viral';
export type ActiveRisingTier = Exclude<RisingTier, 'none'>;
export type ClaimStatus = 'New' | 'Claimed' | 'Clipped' | 'Skipped';

export type AlertType = 'rising' | 'breakout' | 'viral' | 'live_moment' | 'vod_ready';
export type AlertConfidence = 'low' | 'medium' | 'high';
export type NotificationTier = 'P1' | 'P2' | 'P3';
export type NotificationChannel = 'discord' | 'webpush' | 'in_app';

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
  ingestLatencyMs: number | null;
  latestViews: number | null;
  latestLikes: number | null;
  latestComments: number | null;
  claimStatus: ClaimStatus | null;
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
  tier: ActiveRisingTier;
  score: number;
  velocityRatio: number;
  engagementRatio: number;
  reason: string;
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
