export type SystemStatus = 'synced' | 'degraded' | 'offline';

export interface HealthSnapshot {
  status: SystemStatus;
  rawStatus: string;
  environment: string | null;
  serverTime: string | null;
  fetchedAtMs: number;
  latencyMs: number;
  source: string;
  detail: string | null;
}

export interface PrincipalSnapshot {
  authenticated: boolean;
  email: string | null;
  role: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  fetchedAtMs: number;
  source: string;
  errorCode: number | null;
  detail: string | null;
}

const REQUEST_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapHealthStatus(raw: string | null, ok: boolean): SystemStatus {
  if (!ok) return 'degraded';
  const normalized = (raw ?? 'ok').toLowerCase();
  if (normalized === 'ok' || normalized === 'healthy' || normalized === 'synced') {
    return 'synced';
  }
  return 'degraded';
}

export async function fetchHealth(): Promise<HealthSnapshot> {
  const start = performance.now();
  const source = '/api/v1/health';
  try {
    const res = await fetchWithTimeout(source);
    const latencyMs = Math.round(performance.now() - start);
    const payload = asRecord(await res.json().catch(() => null));
    const rawStatus = asString(payload?.['status']) ?? (res.ok ? 'ok' : `http_${res.status}`);
    return {
      status: mapHealthStatus(rawStatus, res.ok),
      rawStatus,
      environment: asString(payload?.['environment']),
      serverTime: asString(payload?.['timestamp']) ?? asString(payload?.['time']),
      fetchedAtMs: Date.now(),
      latencyMs,
      source,
      detail: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const detail = err instanceof Error ? err.message : 'Network error';
    return {
      status: 'offline',
      rawStatus: 'unreachable',
      environment: null,
      serverTime: null,
      fetchedAtMs: Date.now(),
      latencyMs,
      source,
      detail,
    };
  }
}

export async function fetchMe(): Promise<PrincipalSnapshot> {
  const source = '/api/v1/me';
  try {
    const res = await fetchWithTimeout(source);
    const payload = asRecord(await res.json().catch(() => null));
    if (!res.ok) {
      return {
        authenticated: false,
        email: null,
        role: null,
        workspaceId: null,
        workspaceName: null,
        fetchedAtMs: Date.now(),
        source,
        errorCode: res.status,
        detail:
          res.status === 401 || res.status === 403
            ? 'Access JWT not verified or missing'
            : `HTTP ${res.status}`,
      };
    }

    const user = asRecord(payload?.['user']) ?? payload;
    const workspace = asRecord(payload?.['workspace']);
    return {
      authenticated: true,
      email: asString(user?.['email']),
      role: asString(user?.['role']) ?? asString(payload?.['role']),
      workspaceId: asString(user?.['workspaceId']) ?? asString(workspace?.['id']),
      workspaceName: asString(workspace?.['name']),
      fetchedAtMs: Date.now(),
      source,
      errorCode: null,
      detail: null,
    };
  } catch (err) {
    return {
      authenticated: false,
      email: null,
      role: null,
      workspaceId: null,
      workspaceName: null,
      fetchedAtMs: Date.now(),
      source,
      errorCode: null,
      detail: err instanceof Error ? err.message : 'Network error',
    };
  }
}
