import { extractApiErrorMessage } from './api';
import type {
  ActiveRisingTier,
  AdminHealthData,
  AlertDeliveryRecord,
  AlertItem,
  AuditLogResponse,
  ClaimRecord,
  ClaimStatus,
  ClipPlatform,
  ClipRecord,
  CreatorDetail,
  CreatorsListResponse,
  DailyReportData,
  DataQualityReport,
  FeedAge,
  FeedLane,
  FeedResponse,
  FeedSort,
  IntegrationVerifyResponse,
  IntegrationsResponse,
  InviteMemberResponse,
  ItemDetail,
  ItemKind,
  LiveResponse,
  MemberAvailability,
  MissionControlData,
  NotificationPrefs,
  NotificationRecord,
  Platform,
  PushSubscriptionInput,
  RisingResponse,
  SavedViewFilters,
  SavedViewRecord,
  ScorecardData,
  SourceItem,
  SourceItemPickerEntry,
  SourceRule,
  SourceRoiEntry,
  WeeklyReportData,
  WorkBoardResponse,
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

export async function fetchMissionControl(): Promise<MissionControlData> {
  return requestJson<MissionControlData>('/api/v1/mission-control');
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
  patch: {
    starred?: boolean;
    paused?: boolean;
    archived?: boolean;
    isOwn?: boolean;
    groupName?: string | null;
    rules?: Partial<SourceRule>;
  },
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
  lane?: FeedLane;
  sort?: FeedSort;
  age?: FeedAge;
  minViews?: number;
  unseenOnly?: boolean;
  accountId?: string;
  starredOnly?: boolean;
  q?: string;
}): Promise<FeedResponse> {
  const qs = new URLSearchParams();
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.platform) qs.set('platform', params.platform);
  if (params.kind) qs.set('kind', params.kind);
  if (params.lane) qs.set('lane', params.lane);
  if (params.sort) qs.set('sort', params.sort);
  if (params.age) qs.set('age', params.age);
  if (params.minViews !== undefined) qs.set('minViews', String(params.minViews));
  if (params.unseenOnly) qs.set('unseenOnly', 'true');
  if (params.accountId) qs.set('accountId', params.accountId);
  if (params.starredOnly) qs.set('starredOnly', 'true');
  if (params.q) qs.set('q', params.q);
  const query = qs.toString();
  return requestJson<FeedResponse>(`/api/v1/feed${query ? `?${query}` : ''}`);
}

export async function fetchItemDetail(itemId: string): Promise<ItemDetail> {
  return requestJson<ItemDetail>(`/api/v1/feed/${encodeURIComponent(itemId)}/detail`);
}

export async function markItemsSeen(input: {
  itemIds?: string[];
  accountId?: string;
  all?: boolean;
}): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>('/api/v1/feed/mark-seen', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listSavedViews(): Promise<SavedViewRecord[]> {
  const data = await requestJson<{ views?: SavedViewRecord[] } | SavedViewRecord[]>(
    '/api/v1/saved-views',
  );
  return Array.isArray(data) ? data : (data.views ?? []);
}

export async function createSavedView(
  name: string,
  filters: SavedViewFilters,
): Promise<SavedViewRecord> {
  return requestJson<SavedViewRecord>('/api/v1/saved-views', {
    method: 'POST',
    body: JSON.stringify({ name, filters }),
  });
}

export async function deleteSavedView(id: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/v1/saved-views/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
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

export async function fetchWorkBoard(): Promise<WorkBoardResponse> {
  return requestJson<WorkBoardResponse>('/api/v1/claims');
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

export async function claimFromAlert(alertId: string): Promise<ClaimRecord> {
  return requestJson<ClaimRecord>(
    `/api/v1/claims/from-alert/${encodeURIComponent(alertId)}`,
    { method: 'POST' },
  );
}

export async function updateClaim(
  claimId: string,
  patch: { status: ClaimStatus; note?: string | null; clipUrl?: string | null },
): Promise<ClaimRecord> {
  return requestJson<ClaimRecord>(`/api/v1/claims/${encodeURIComponent(claimId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteClaim(claimId: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/v1/claims/${encodeURIComponent(claimId)}`, {
    method: 'DELETE',
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

export async function acknowledgeAlert(
  alertId: string,
  note?: string,
): Promise<{ ok: boolean; acknowledgedAt?: string }> {
  return requestJson<{ ok: boolean; acknowledgedAt?: string }>(
    `/api/v1/alerts/${encodeURIComponent(alertId)}/acknowledge`,
    {
      method: 'POST',
      body: JSON.stringify(note ? { note } : {}),
    },
  );
}

export async function listNotificationDeliveries(): Promise<AlertDeliveryRecord[]> {
  const data = await requestJson<
    { deliveries?: AlertDeliveryRecord[]; items?: AlertDeliveryRecord[] } | AlertDeliveryRecord[]
  >('/api/v1/notifications/deliveries');
  if (Array.isArray(data)) return data;
  return data.deliveries ?? data.items ?? [];
}

export async function sendTestNotification(
  channel: 'discord' | 'in_app' | 'webpush',
): Promise<{ ok: boolean; status?: string; detail?: string; message?: string }> {
  return requestJson('/api/v1/notifications/test', {
    method: 'POST',
    body: JSON.stringify({ channel }),
  });
}

export async function fetchMemberAvailability(): Promise<MemberAvailability> {
  return requestJson<MemberAvailability>('/api/v1/settings/availability');
}

export async function updateMemberAvailability(
  payload: MemberAvailability,
): Promise<MemberAvailability> {
  return requestJson<MemberAvailability>('/api/v1/settings/availability', {
    method: 'PUT',
    body: JSON.stringify(payload),
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

export async function listClips(): Promise<{
  clips: ClipRecord[];
  sourceItems: SourceItemPickerEntry[];
}> {
  const data = await requestJson<
    { clips?: ClipRecord[]; items?: ClipRecord[]; sourceItems?: SourceItemPickerEntry[] } | ClipRecord[]
  >('/api/v1/clips');
  if (Array.isArray(data)) return { clips: data, sourceItems: [] };
  return {
    clips: data.clips ?? data.items ?? [],
    sourceItems: data.sourceItems ?? [],
  };
}

export async function createClip(input: {
  url: string;
  platform: ClipPlatform;
  title?: string;
  description?: string;
  sourceItemId?: string;
  manualStats?: { views: number; likes?: number; comments?: number };
  manualRevenueCents?: number;
  publishTime?: string;
  startSec?: number;
  endSec?: number;
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

export async function fetchDailyReport(date?: string, ai = false): Promise<DailyReportData> {
  const qs = new URLSearchParams();
  if (date) qs.set('date', date);
  if (ai) qs.set('ai', 'true');
  const query = qs.toString();
  return requestJson<DailyReportData>(`/api/v1/reports/daily${query ? `?${query}` : ''}`);
}

export async function fetchWeeklyReport(): Promise<WeeklyReportData> {
  return requestJson<WeeklyReportData>('/api/v1/reports/weekly');
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

export async function fetchAdminIntegrations(): Promise<IntegrationsResponse> {
  return requestJson<IntegrationsResponse>('/api/v1/admin/integrations');
}

export async function verifyAdminIntegration(
  platform: Platform,
): Promise<IntegrationVerifyResponse> {
  return requestJson<IntegrationVerifyResponse>(
    `/api/v1/admin/integrations/${encodeURIComponent(platform)}/verify`,
    { method: 'POST' },
  );
}

export async function fetchCreators(): Promise<CreatorsListResponse> {
  return requestJson<CreatorsListResponse>('/api/v1/creators');
}

export async function fetchCreatorDetail(accountId: string): Promise<CreatorDetail> {
  return requestJson<CreatorDetail>(`/api/v1/creators/${encodeURIComponent(accountId)}`);
}

export async function updateCreatorNotes(
  accountId: string,
  body: string,
): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(
    `/api/v1/creators/${encodeURIComponent(accountId)}/notes`,
    { method: 'PUT', body: JSON.stringify({ body }) },
  );
}

export async function inviteMember(input: {
  email: string;
  role: WorkspaceRole;
  temporaryPassphrase: string;
}): Promise<InviteMemberResponse> {
  return requestJson<InviteMemberResponse>('/api/v1/settings/members/invite', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchAdminHealth(): Promise<AdminHealthData> {
  return requestJson<AdminHealthData>('/api/v1/admin/health');
}

export async function retryAdminDlq(input: {
  id?: string;
  queueName?: 'ingest-dlq' | 'notify-dlq';
}): Promise<{ ok: boolean; retriedCount: number; remainingPending: number }> {
  return requestJson('/api/v1/admin/dlq/retry', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchAuditLog(params: {
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<AuditLogResponse> {
  const qs = new URLSearchParams();
  if (params.action) qs.set('action', params.action);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.limit) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return requestJson<AuditLogResponse>(`/api/v1/admin/audit-log${q ? `?${q}` : ''}`);
}

export async function fetchDataQuality(): Promise<DataQualityReport> {
  return requestJson<DataQualityReport>('/api/v1/admin/data-quality');
}
