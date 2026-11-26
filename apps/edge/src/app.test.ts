import { beforeAll, describe, expect, it } from 'vitest';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
} from 'jose';
import { CloudflareAccessAuthProvider } from './auth.js';
import { createApp, type EdgeBindings } from './app.js';
import { SECURITY_HEADERS } from './security.js';

interface MembershipRecord {
  workspace_id: string;
  role: string;
}

function createMockDb(
  memberships: Record<string, MembershipRecord>,
  failHealthQuery = false,
): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM memberships')) {
                const userId = String(args[0] ?? '');
                return (memberships[userId] as T | undefined) ?? null;
              }
              return null;
            },
          };
        },
        async first<T>() {
          if (failHealthQuery) {
            throw new Error('D1 unavailable');
          }
          if (sql.includes('SELECT 1')) {
            return { ok: 1 } as T;
          }
          return null;
        },
      };
    },
  } as unknown as D1Database;
}

describe('edge app security, auth, and tenant isolation', () => {
  const teamDomain = 'clipse-test.cloudflareaccess.com';
  const issuer = `https://${teamDomain}`;
  const audience = 'clipse-test-aud';

  let privateKey: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const kp = await generateKeyPair('RS256');
    privateKey = kp.privateKey;
    const publicJwk: JWK = await exportJWK(kp.publicKey);
    publicJwk.kid = 'test-key-1';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    jwks = createLocalJWKSet({ keys: [publicJwk] });
  });

  async function signAccessJwt(opts: {
    sub?: string;
    email?: string;
    aud?: string;
    iss?: string;
    exp?: string | number;
  }): Promise<string> {
    const builder = new SignJWT({
      email: opts.email ?? 'alice@example.com',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setSubject(opts.sub ?? 'user-alice')
      .setIssuer(opts.iss ?? issuer)
      .setAudience(opts.aud ?? audience)
      .setIssuedAt();

    if (opts.exp !== undefined) {
      builder.setExpirationTime(opts.exp);
    } else {
      builder.setExpirationTime('10m');
    }

    return builder.sign(privateKey);
  }

  function makeEnv(
    memberships: Record<string, MembershipRecord> = {
      'user-alice': { workspace_id: 'ws-alpha', role: 'Owner' },
      'user-bob': { workspace_id: 'ws-beta', role: 'Member' },
    },
    failHealth = false,
  ): EdgeBindings {
    return {
      DB: createMockDb(memberships, failHealth),
      WORKSPACE_DO: {} as unknown as EdgeBindings['WORKSPACE_DO'],
      ENVIRONMENT: 'local',
      AI_INSIGHTS_ENABLED: 'false',
      ACCESS_TEAM_DOMAIN: teamDomain,
      ACCESS_AUD: audience,
    };
  }

  function makeTestApp() {
    return createApp({
      authProviderFactory: (env) =>
        new CloudflareAccessAuthProvider(
          env.ACCESS_TEAM_DOMAIN ?? teamDomain,
          env.ACCESS_AUD ?? audience,
          jwks,
        ),
    });
  }

  it('sets strict security headers on responses', async () => {
    const app = makeTestApp();
    const res = await app.request(
      'https://radar.example.com/api/v1/health',
      {},
      makeEnv(),
    );
    expect(res.status).toBe(200);
    for (const [key, expected] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(key)).toBe(expected);
    }
    const body = (await res.json()) as { status: string; source: string };
    expect(body.status).toBe('ok');
    expect(body.source).toBe('edge');
  });

  it('reports degraded health when D1 query fails', async () => {
    const app = makeTestApp();
    const res = await app.request(
      'https://radar.example.com/api/v1/health',
      {},
      makeEnv({}, true),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('degraded');
  });

  it('rejects missing, invalid, wrong-audience, and expired Access JWTs', async () => {
    const app = makeTestApp();
    const env = makeEnv();

    const missingRes = await app.request(
      'https://radar.example.com/api/v1/me',
      {},
      env,
    );
    expect(missingRes.status).toBe(401);

    const invalidRes = await app.request(
      'https://radar.example.com/api/v1/me',
      { headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' } },
      env,
    );
    expect(invalidRes.status).toBe(401);

    const wrongAudJwt = await signAccessJwt({ aud: 'wrong-aud' });
    const wrongAudRes = await app.request(
      'https://radar.example.com/api/v1/me',
      { headers: { 'Cf-Access-Jwt-Assertion': wrongAudJwt } },
      env,
    );
    expect(wrongAudRes.status).toBe(401);

    const expiredJwt = await signAccessJwt({
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const expiredRes = await app.request(
      'https://radar.example.com/api/v1/me',
      { headers: { 'Cf-Access-Jwt-Assertion': expiredJwt } },
      env,
    );
    expect(expiredRes.status).toBe(401);
  });

  it('authenticates valid Access JWT and returns D1-resolved principal', async () => {
    const app = makeTestApp();
    const jwt = await signAccessJwt({
      sub: 'user-alice',
      email: 'alice@example.com',
    });

    const res = await app.request(
      'https://radar.example.com/api/v1/me',
      { headers: { 'Cf-Access-Jwt-Assertion': jwt } },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: 'user-alice',
      email: 'alice@example.com',
      workspaceId: 'ws-alpha',
      role: 'Owner',
    });
  });

  it('returns 403 when authenticated user has no workspace membership', async () => {
    const app = makeTestApp();
    const jwt = await signAccessJwt({
      sub: 'user-outsider',
      email: 'outsider@example.com',
    });

    const res = await app.request(
      'https://radar.example.com/api/v1/me',
      { headers: { 'Cf-Access-Jwt-Assertion': jwt } },
      makeEnv(),
    );
    expect(res.status).toBe(403);
  });

  it('enforces CSRF Origin and Sec-Fetch-Site checks on mutations', async () => {
    const app = makeTestApp();
    const jwt = await signAccessJwt({ sub: 'user-alice' });
    const env = makeEnv();

    const crossSite = await app.request(
      'https://radar.example.com/api/v1/workspaces/ping',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': jwt,
          'Sec-Fetch-Site': 'cross-site',
          Origin: 'https://evil.example.com',
        },
      },
      env,
    );
    expect(crossSite.status).toBe(403);

    const originMismatch = await app.request(
      'https://radar.example.com/api/v1/workspaces/ping',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': jwt,
          Origin: 'https://evil.example.com',
        },
      },
      env,
    );
    expect(originMismatch.status).toBe(403);

    const missingOrigin = await app.request(
      'https://radar.example.com/api/v1/workspaces/ping',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': jwt,
        },
      },
      env,
    );
    expect(missingOrigin.status).toBe(403);

    const sameOrigin = await app.request(
      'https://radar.example.com/api/v1/workspaces/ping',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': jwt,
          'Sec-Fetch-Site': 'same-origin',
          Origin: 'https://radar.example.com',
        },
      },
      env,
    );
    expect(sameOrigin.status).toBe(200);
    expect(await sameOrigin.json()).toEqual({
      ok: true,
      workspaceId: 'ws-alpha',
    });
  });

  it('enforces tenant isolation against client-supplied workspaceId and cross-tenant routes', async () => {
    const app = makeTestApp();
    const aliceJwt = await signAccessJwt({ sub: 'user-alice' });
    const env = makeEnv();

    // Client-supplied header/query cannot override D1-resolved workspaceId
    const spoofedRes = await app.request(
      'https://radar.example.com/api/v1/me?workspaceId=ws-beta',
      {
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          'X-Workspace-Id': 'ws-beta',
        },
      },
      env,
    );
    expect(spoofedRes.status).toBe(200);
    expect(await spoofedRes.json()).toMatchObject({ workspaceId: 'ws-alpha' });

    // Cross-tenant route access is rejected with 403
    const crossTenantRes = await app.request(
      'https://radar.example.com/api/v1/workspaces/ws-beta/check',
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    expect(crossTenantRes.status).toBe(403);

    // Own workspace check succeeds
    const ownTenantRes = await app.request(
      'https://radar.example.com/api/v1/workspaces/ws-alpha/check',
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    expect(ownTenantRes.status).toBe(200);
  });
});
