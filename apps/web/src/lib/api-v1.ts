import { extractApiErrorMessage } from './api';
import type {
  ActiveRisingTier,
  AlertItem,
  ClaimRecord,
  ClaimStatus,
  ClipPlatform,
  ClipRecord,
  DailyReportData,
  FeedResponse,
  ItemKind,
  LiveResponse,
  NotificationPrefs,
  NotificationRecord,
  Platform,
  PushSubscriptionInput,
  RisingResponse,
  ScorecardData,
  SourceItem,
  SourceRoiEntry,
  WorkspaceMember,
  WorkspaceRole,
} from './contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ProviderStatusEntry {
  status: string;
  label: string;
}

export interface ProviderStatusMap {
  youtube: ProviderStatusEntry;
  twitch: ProviderStatusEntry;
  kick: ProviderStatusEntry;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, extractApiErrorMessage(payload, `Request failed (${res.status})`));
  }
  return payload as T;
}

export async function fetchProviderStatus(): Promise<ProviderStatusMap> {
  const data = await requestJson<{ providers?: ProviderStatusMap } | ProviderStatusMap>(
    '/api/v1/providers/status',
  );
  if ('providers' in data && data.providers) {
    return data.providers;
  }
  return data as ProviderStatusMap;
}

export async function listSources(): Promise<SourceItem[]> {
  const data = await requestJson<{ sources?: SourceItem[]; items?: SourceItem[] } | SourceItem[]>(
    '/api/v1/sources',
  );
  if (Array.isArray(data)) return data;
  return data.sources ?? data.items ?? [];
}

export async function createSource(input: {
  input: string;
  starred?: boolean;
  groupName?: string;
  tags?: string[];
}): Promise<SourceItem> {
  return requestJson<SourceItem>('/api/v1/sources', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function bulkCreateSources(input: {
  rawLines: string;
  groupName?: string;
  tags?: string[];
  starred?: boolean;
}): Promise<{ created?: number; sources?: SourceItem[] }> {
  return requestJson('/api/v1/sources/bulk', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateSource(
  followId: string,
  patch: { starred?: boolean; paused?: boolean; archived?: boolean; groupName?: string | null },
): Promise<SourceItem> {
  return requestJson<SourceItem>(`/api/v1/sources/${encodeURIComponent(followId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function syncSource(followId: string): Promise<{ ok?: boolean; itemsIngested?: number }> {
  return requestJson<{ ok?: boolean; itemsIngested?: number }>(
    `/api/v1/sources/${encodeURIComponent(followId)}/sync`,
    { method: 'POST' },
  );
}

export async function syncAllSources(): Promise<{ ok?: boolean; synced?: number }> {
  return requestJson<{ ok?: boolean; synced?: number }>('/api/v1/sources/sync-all', {
    method: 'POST',
  });
}

export async function fetchFeed(params: {
  cursor?: string;
  limit?: number;
  platform?: Platform;
  kind?: ItemKind;
  starredOnly?: boolean;
  q?: string;
}): Promise<FeedResponse> {
  const qs = new URLSearchParams();
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.platform) qs.set('platform', params.platform);
  if (params.kind) qs.set('kind', params.kind);
  if (params.starredOnly) qs.set('starredOnly', 'true');
  if (params.q) qs.set('q', params.q);
  const query = qs.toString();
  return requestJson<FeedResponse>(`/api/v1/feed${query ? `?${query}` : ''}`);
}

export async function fetchLive(): Promise<LiveResponse> {
  return requestJson<LiveResponse>('/api/v1/live');
}

export async function fetchRising(params: {
  tier?: ActiveRisingTier;
  platform?: Platform;
  limit?: number;
}): Promise<RisingResponse> {
  const qs = new URLSearchParams();
  if (params.tier) qs.set('tier', params.tier);
  if (params.platform) qs.set('platform', params.platform);
  if (params.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return requestJson<RisingResponse>(`/api/v1/rising${query ? `?${query}` : ''}`);
}

export async function listClaims(): Promise<ClaimRecord[]> {
  const data = await requestJson<{ claims?: ClaimRecord[]; items?: ClaimRecord[] } | ClaimRecord[]>(
    '/api/v1/claims',
  );
  if (Array.isArray(data)) return data;
  return data.claims ?? data.items ?? [];
}

export async function createClaim(input: {
  itemId: string;
  startSec?: number;
  endSec?: number;
  note?: string;
}): Promise<ClaimRecord> {
  return requestJson<ClaimRecord>('/api/v1/claims', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateClaim(
  claimId: string,
  patch: { status: ClaimStatus; note?: string | null },
): Promise<ClaimRecord> {
  return requestJson<ClaimRecord>(`/api/v1/claims/${encodeURIComponent(claimId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function listAlerts(): Promise<AlertItem[]> {
  const data = await requestJson<{ alerts?: AlertItem[]; items?: AlertItem[] } | AlertItem[]>(
    '/api/v1/alerts',
  );
  if (Array.isArray(data)) return data;
  return data.alerts ?? data.items ?? [];
}

export async function voteAlert(alertId: string, useful: boolean): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/v1/alerts/${encodeURIComponent(alertId)}/vote`, {
    method: 'POST',
    body: JSON.stringify({ useful }),
  });
}

export async function listNotifications(): Promise<{
  notifications: NotificationRecord[];
  prefs?: NotificationPrefs;
}> {
  const data = await requestJson<
    | { notifications?: NotificationRecord[]; items?: NotificationRecord[]; prefs?: NotificationPrefs }
    | NotificationRecord[]
  >('/api/v1/notifications');
  if (Array.isArray(data)) return { notifications: data };
  return {
    notifications: data.notifications ?? data.items ?? [],
    prefs: data.prefs,
  };
}

export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
  });
}

export async function updateNotificationPrefs(
  prefs: NotificationPrefs,
): Promise<NotificationPrefs> {
  return requestJson<NotificationPrefs>('/api/v1/notifications/prefs', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
}

export async function registerPushSubscription(
  sub: PushSubscriptionInput,
): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>('/api/v1/notifications/push', {
    method: 'POST',
    body: JSON.stringify(sub),
  });
}

export async function updateDiscordWebhook(
  webhookUrl: string | null,
): Promise<{ configured: boolean }> {
  return requestJson<{ configured: boolean }>('/api/v1/notifications/discord', {
    method: 'PUT',
    body: JSON.stringify({ webhookUrl }),
  });
}

export async function listClips(): Promise<ClipRecord[]> {
  const data = await requestJson<{ clips?: ClipRecord[]; items?: ClipRecord[] } | ClipRecord[]>(
    '/api/v1/clips',
  );
  if (Array.isArray(data)) return data;
  return data.clips ?? data.items ?? [];
}

export async function createClip(input: {
  url: string;
  platform: ClipPlatform;
  title?: string;
  description?: string;
  sourceItemId?: string;
  manualStats?: { views: number; likes?: number; comments?: number };
}): Promise<ClipRecord> {
  return requestJson<ClipRecord>('/api/v1/clips', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function confirmClipLink(
  clipId: string,
  sourceItemId: string,
): Promise<ClipRecord> {
  return requestJson<ClipRecord>(`/api/v1/clips/${encodeURIComponent(clipId)}/confirm-link`, {
    method: 'POST',
    body: JSON.stringify({ sourceItemId }),
  });
}

export async function fetchSourceRoi(): Promise<SourceRoiEntry[]> {
  const data = await requestJson<{ entries?: SourceRoiEntry[]; items?: SourceRoiEntry[] } | SourceRoiEntry[]>(
    '/api/v1/roi',
  );
  if (Array.isArray(data)) return data;
  return data.entries ?? data.items ?? [];
}

export async function fetchScorecard(): Promise<ScorecardData> {
  return requestJson<ScorecardData>('/api/v1/admin/scorecard');
}

export async function fetchDailyReport(date?: string): Promise<DailyReportData> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  return requestJson<DailyReportData>(`/api/v1/reports/daily${qs}`);
}

export async function listMembers(): Promise<WorkspaceMember[]> {
  const data = await requestJson<
    { members?: WorkspaceMember[]; items?: WorkspaceMember[] } | WorkspaceMember[]
  >('/api/v1/settings/members');
  if (Array.isArray(data)) return data;
  return data.members ?? data.items ?? [];
}

export async function updateMemberRole(
  userId: string,
  role: WorkspaceRole,
): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/v1/settings/members/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function removeMember(userId: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/v1/settings/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export async function exportWorkspace(format: 'json' | 'csv'): Promise<Blob> {
  const res = await fetch('/api/v1/export', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Export failed (${res.status})`);
  }
  return res.blob();
}

export async function deleteWorkspace(): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>('/api/v1/settings/workspace', {
    method: 'DELETE',
  });
}
