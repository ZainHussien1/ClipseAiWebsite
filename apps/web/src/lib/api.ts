export type SystemStatus = 'synced' | 'degraded' | 'offline';

export interface HealthProviderEntry {
  status: string;
  label: string;
}

export interface HealthSnapshot {
  status: SystemStatus;
  rawStatus: string;
  environment: string | null;
  authMode: 'access' | 'session' | null;
  authConfigured: boolean;
  providers: Record<string, HealthProviderEntry>;
  lastIngestAt: string | null;
  checkedAt: string | null;
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

function parseProviders(raw: unknown): Record<string, HealthProviderEntry> {
  const rec = asRecord(raw);
  if (!rec) return {};
  const out: Record<string, HealthProviderEntry> = {};
  for (const [k, v] of Object.entries(rec)) {
    const entry = asRecord(v);
    if (entry) {
      out[k] = {
        status: asString(entry['status']) ?? 'unknown',
        label: asString(entry['label']) ?? 'Unknown',
      };
    }
  }
  return out;
}

export async function fetchHealth(): Promise<HealthSnapshot> {
  const start = performance.now();
  try {
    const res = await fetchWithTimeout('/api/v1/health');
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
      authConfigured: Boolean(payload?.['authConfigured']),
      providers: parseProviders(payload?.['providers']),
      lastIngestAt: asString(payload?.['lastIngestAt']),
      checkedAt: asString(payload?.['checkedAt']) ?? asString(payload?.['timestamp']),
      fetchedAtMs: Date.now(),
      latencyMs,
      source: 'Edge Health',
      detail: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      status: 'offline',
      rawStatus: 'unreachable',
      environment: null,
      authMode: null,
      authConfigured: false,
      providers: {},
      lastIngestAt: null,
      checkedAt: null,
      fetchedAtMs: Date.now(),
      latencyMs,
      source: 'Edge Health',
      detail: err instanceof Error ? err.message : 'Network error',
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

export async function requestAuthCode(email: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetchWithTimeout('/api/v1/auth/request-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractApiErrorMessage(payload, `Code request failed (${res.status})`));
  }
  const rec = asRecord(payload);
  return {
    ok: Boolean(rec?.['ok'] ?? true),
    message:
      asString(rec?.['message']) ??
      'If your email is allowlisted, a verification code has been sent.',
  };
}

export async function loginWorkspaceSession(input: {
  email: string;
  workspaceName?: string;
  code?: string;
  passphrase?: string;
}): Promise<{ ok?: boolean; email?: string }> {
  const res = await fetchWithTimeout('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractApiErrorMessage(payload, `Sign-in failed (${res.status})`));
  }
  return (asRecord(payload) ?? { ok: true }) as { ok?: boolean; email?: string };
}

export async function setAccountPassphrase(passphrase: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout('/api/v1/auth/passphrase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(extractApiErrorMessage(payload, `Passphrase update failed (${res.status})`));
  }
  return { ok: true };
}

export async function logoutSession(): Promise<void> {
  await fetchWithTimeout('/api/v1/auth/logout', { method: 'POST' });
}

export async function fetchMe(): Promise<PrincipalSnapshot> {
  const source = 'Access / Session';
  try {
    const res = await fetchWithTimeout('/api/v1/me');
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
            ? 'Session or Access JWT not verified'
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
