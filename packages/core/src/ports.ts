import type { Platform, VerifiedIdentity } from './types.js';

export interface AuthProvider {
  verifyToken(token: string): Promise<VerifiedIdentity>;
}

export interface ProviderChannel {
  readonly platform: Platform;
  readonly externalId: string;
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
}

export interface ProviderItem {
  readonly platform: Platform;
  readonly externalId: string;
  readonly accountExternalId: string;
  readonly kind: 'video' | 'short' | 'live' | 'vod' | 'clip';
  readonly title: string;
  readonly url: string;
  readonly thumbnailUrl?: string;
  readonly publishedAt: string;
  readonly durationSec?: number;
  readonly shortsClassification?: 'video' | 'short' | 'live' | 'unclassified';
}

export interface ProviderItemStats {
  readonly externalId: string;
  readonly capturedAt: string;
  readonly views: number;
  readonly likes?: number;
  readonly comments?: number;
}

export interface ProviderLiveStatus {
  readonly accountExternalId: string;
  readonly isLive: boolean;
  readonly streamExternalId?: string;
  readonly title?: string;
  readonly viewers?: number;
  readonly startedAt?: string;
}

export interface Provider {
  readonly platform: Platform;
  fetchChannel(externalIdOrHandle: string): Promise<ProviderChannel | null>;
  fetchRecentItems(accountExternalId: string): Promise<readonly ProviderItem[]>;
  fetchStatsBatch(externalIds: readonly string[]): Promise<readonly ProviderItemStats[]>;
  fetchLiveStatus(accountExternalIds: readonly string[]): Promise<readonly ProviderLiveStatus[]>;
}

export interface DailyDigestInput {
  readonly dateIso: string;
  readonly workspaceName: string;
  readonly metrics: Readonly<Record<string, number>>;
}

export interface InsightsProvider {
  isEnabled(): boolean;
  summarizeDailyDigest(input: DailyDigestInput): Promise<string | null>;
  suggestTopics(title: string, description?: string): Promise<readonly string[]>;
}

export interface ExportResult {
  readonly key: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly url?: string;
}

export interface ExportStorage {
  putExport(key: string, body: string, contentType: string): Promise<ExportResult>;
  getExport(key: string): Promise<{ body: string; contentType: string } | null>;
}

export interface NotificationMessage {
  readonly tier: 'P1' | 'P2' | 'P3';
  readonly title: string;
  readonly body: string;
  readonly url?: string;
}

export interface NotifyDeliveryResult {
  readonly delivered: boolean;
  readonly statusCode?: number;
  readonly retryAfterSeconds?: number;
}

export interface Notifier {
  readonly channel: 'discord' | 'webpush' | 'in_app';
  send(message: NotificationMessage): Promise<NotifyDeliveryResult>;
}
