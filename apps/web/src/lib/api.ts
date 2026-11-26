export type SystemStatus = 'synced' | 'degraded' | 'offline';

export interface HealthSnapshot {
  status: SystemStatus;
  rawStatus: string;
  environment: string | null;
  authMode: 'access' | 'session' | null;
  serverTime: string | null;
  fetchedAtMs: number;
  latencyMs: number;
  source: string;
  detail: string | null;
}

export interface AuthStatusSnapshot {
  mode: 'access' | 'session';
  authenticated: boolean;
  email: string | null;
  hasWorkspace: boolean;
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

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...init?.headers,
      },
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
    const rawAuthMode = asString(payload?.['authMode']);
    const authMode = rawAuthMode === 'access' || rawAuthMode === 'session' ? rawAuthMode : null;
    return {
      status: mapHealthStatus(rawStatus, res.ok),
      rawStatus,
      environment: asString(payload?.['environment']),
      authMode,
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
      authMode: null,
      serverTime: null,
      fetchedAtMs: Date.now(),
      latencyMs,
      source,
      detail,
    };
  }
}

export async function fetchAuthStatus(): Promise<AuthStatusSnapshot> {
  const res = await fetchWithTimeout('/api/v1/auth/status');
  if (!res.ok) {
    throw new Error(`Auth status failed (${res.status})`);
  }
  return (await res.json()) as AuthStatusSnapshot;
}

export function extractApiErrorMessage(payload: unknown, fallback: string): string {
  const rec = asRecord(payload);
  if (!rec) return fallback;
  const errVal = rec['error'];
  if (typeof errVal === 'string' && errVal.length > 0) return errVal;
  const errRec = asRecord(errVal);
  const nestedMsg = asString(errRec?.['message']);
  if (nestedMsg) return nestedMsg;
  return asString(rec['message']) ?? fallback;
}

export async function bootstrapWorkspaceSession(
  email: string,
  workspaceName?: string,
): Promise<{ ok?: boolean; email?: string }> {
  const res = await fetchWithTimeout('/api/v1/auth/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      ...(workspaceName ? { workspaceName } : {}),
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractApiErrorMessage(payload, `Sign-in failed (${res.status})`));
  }
  return (asRecord(payload) ?? { ok: true }) as { ok?: boolean; email?: string };
}

export async function logoutSession(): Promise<void> {
  await fetchWithTimeout('/api/v1/auth/logout', { method: 'POST' });
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
