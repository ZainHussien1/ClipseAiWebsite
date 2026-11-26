export type Platform = 'youtube' | 'twitch' | 'kick';
export type ItemKind = 'video' | 'short' | 'live' | 'vod' | 'clip';
export type RisingTier = 'none' | 'rising' | 'breakout' | 'viral';
export type ActiveRisingTier = Exclude<RisingTier, 'none'>;
export type ClaimStatus = 'New' | 'Claimed' | 'Clipped' | 'Skipped';

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
