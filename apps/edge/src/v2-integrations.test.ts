import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// @ts-expect-error node:sqlite is built-in in Node 22+
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type EdgeBindings } from './app.js';
import { hashOtpCode } from './session.js';

function createSqliteD1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const makeStmt = (params: unknown[]) => ({
        bind(...args: unknown[]) {
          bound = args;
          return makeStmt(bound);
        },
        async first<T>() {
          const stmt = db.prepare(sql);
          const row = stmt.get(...(params as (string | number | null)[])) as T | undefined;
          return row ?? null;
        },
        async all<T>() {
          const stmt = db.prepare(sql);
          const results = stmt.all(...(params as (string | number | null)[])) as T[];
          return { results, success: true, meta: {} };
        },
        async run() {
          const stmt = db.prepare(sql);
          const info = stmt.run(...(params as (string | number | null)[]));
          return {
            success: true,
            meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
          };
        },
      });
      return makeStmt(bound);
    },
  } as unknown as D1Database;
}

describe('V2 Integrations API, OAuth callbacks, and dynamic Kick public key', () => {
  let sqlite: DatabaseSync;
  const sessionSecret = 'v2-integrations-session-secret-32c';

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    const migrationsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'migrations',
    );
    for (const file of [
      '0001_init.sql',
      '0002_ingestion.sql',
      '0003_phase3.sql',
      '0004_phase4.sql',
      '0005_phase5.sql',
      '0006_v2_upgrade.sql',
    ]) {
      sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    }

    sqlite.exec(`
      INSERT INTO workspaces (id, slug, name, timezone) VALUES ('ws-1', 'ws1', 'Studio', 'UTC');
      INSERT INTO memberships (id, workspace_id, user_id, email, role) VALUES
        ('m-admin', 'ws-1', 'u-admin', 'admin@example.com', 'Admin'),
        ('m-member', 'ws-1', 'u-member', 'member@example.com', 'Member');
      INSERT INTO webhook_subscriptions (id, platform, account_external_id, topic, status, lease_expires_at) VALUES
        ('sub-1', 'youtube', 'UC123', 'feed', 'active', '2026-12-01T00:00:00Z');
      INSERT INTO ingestion_metrics (id, platform, metric_date, pushes_received, missed_pushes, reconcile_runs) VALUES
        ('im-1', 'youtube', '${new Date().toISOString().slice(0, 10)}', 4, 0, 2);
    `);
  });

  function makeEnv(overrides: Partial<EdgeBindings> = {}): EdgeBindings {
    return {
      DB: createSqliteD1(sqlite),
      WORKSPACE_DO: {} as unknown as EdgeBindings['WORKSPACE_DO'],
      ENVIRONMENT: 'staging',
      AI_INSIGHTS_ENABLED: 'false',
      SESSION_SECRET: sessionSecret,
      TWITCH_CLIENT_ID: 'secret-twitch-id-value',
      TWITCH_CLIENT_SECRET: 'secret-twitch-secret-value',
      ...overrides,
    };
  }

  async function loginAs(
    app: ReturnType<typeof createApp>,
    env: EdgeBindings,
    email: string,
    code: string,
  ): Promise<string> {
    const nowIso = new Date().toISOString();
    const expIso = new Date(Date.now() + 600_000).toISOString();
    sqlite
      .prepare(
        'INSERT INTO auth_otps (id, email, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)',
      )
      .run(`otp-${email}`, email, await hashOtpCode(code), expIso, nowIso);

    const res = await app.request(
      'https://radar.example.com/api/v1/auth/login',
      {
        method: 'POST',
        headers: {
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, code }),
      },
      env,
    );
    return (res.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  }

  it('enforces Admin+ RBAC, exposes boolean-only secretPresence, and verifies via ENGINE', async () => {
    const app = createApp();
    const env = makeEnv({
      ENGINE: {
        async verifyProviderConnection(platform) {
          return {
            ok: true,
            status: 'healthy',
            message: `${platform} OAuth token verified`,
          };
        },
      },
    });

    const memberCookie = await loginAs(app, env, 'member@example.com', '111111');
    const adminCookie = await loginAs(app, env, 'admin@example.com', '222222');

    // Member rejected with 403
    const memberGet = await app.request(
      'https://radar.example.com/api/v1/admin/integrations',
      { headers: { Cookie: memberCookie } },
      env,
    );
    expect(memberGet.status).toBe(403);

    // Admin gets integrations without leaking raw secret values
    const adminGet = await app.request(
      'https://radar.example.com/api/v1/admin/integrations',
      { headers: { Cookie: adminCookie } },
      env,
    );
    expect(adminGet.status).toBe(200);
    const text = await adminGet.text();
    expect(text).not.toContain('secret-twitch-id-value');
    expect(text).not.toContain('secret-twitch-secret-value');

    const body = JSON.parse(text) as {
      integrations: Array<{
        platform: string;
        status: string;
        secretPresence: Record<string, boolean>;
        subscriptionCount: number;
        quotaUsedToday: number;
        callbackUrls: { webhookUrl: string; oauthCallbackUrl: string | null };
      }>;
    };
    const yt = body.integrations.find((i) => i.platform === 'youtube');
    const tw = body.integrations.find((i) => i.platform === 'twitch');
    const kk = body.integrations.find((i) => i.platform === 'kick');

    expect(yt?.status).toBe('healthy');
    expect(yt?.subscriptionCount).toBe(1);
    expect(yt?.quotaUsedToday).toBe(6);
    expect(yt?.callbackUrls.webhookUrl).toBe('https://radar.example.com/hooks/youtube');

    expect(tw?.status).toBe('healthy');
    expect(tw?.secretPresence.TWITCH_CLIENT_ID).toBe(true);
    expect(tw?.callbackUrls.oauthCallbackUrl).toBe(
      'https://radar.example.com/api/v1/integrations/twitch/callback',
    );
    expect(kk?.status).toBe('not_configured');

    // Verify endpoint calls ENGINE & writes audit_logs
    const verifyRes = await app.request(
      'https://radar.example.com/api/v1/admin/integrations/twitch/verify',
      {
        method: 'POST',
        headers: { Cookie: adminCookie, Origin: 'https://radar.example.com' },
      },
      env,
    );
    expect(verifyRes.status).toBe(200);
    expect(await verifyRes.json()).toMatchObject({
      ok: true,
      platform: 'twitch',
      status: 'healthy',
    });

    const auditRow = sqlite
      .prepare("SELECT action, target_id FROM audit_logs WHERE action = 'integration.verified'")
      .get() as { action: string; target_id: string };
    expect(auditRow).toEqual({ action: 'integration.verified', target_id: 'twitch' });
  });

  it('handles OAuth callbacks safely without echoing tokens', async () => {
    const app = createApp();
    const env = makeEnv();

    const okCb = await app.request(
      'https://radar.example.com/api/v1/integrations/twitch/callback?code=secret-oauth-code&state=abc',
      {},
      env,
    );
    expect(okCb.status).toBe(302);
    const loc = okCb.headers.get('Location') ?? '';
    expect(loc).toBe(
      'https://radar.example.com/settings?tab=integrations&provider=twitch&status=callback_ok',
    );
    expect(loc).not.toContain('secret-oauth-code');

    const errCb = await app.request(
      'https://radar.example.com/api/v1/integrations/kick/callback?error=access_denied',
      {},
      env,
    );
    expect(errCb.status).toBe(302);
    expect(errCb.headers.get('Location')).toBe(
      'https://radar.example.com/settings?tab=integrations&provider=kick&status=callback_error',
    );
  });

  it('fetches Kick public key dynamically when KICK_PUBLIC_KEY env is unset', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const spki = (await crypto.subtle.exportKey('spki', kp.publicKey)) as ArrayBuffer;
    const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(spki)))}\n-----END PUBLIC KEY-----`;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === 'https://api.kick.com/public/v1/public-key') {
        return new Response(JSON.stringify({ data: { public_key: pem } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    try {
      const app = createApp();
      const env = makeEnv(); // KICK_PUBLIC_KEY intentionally omitted
      const nowIso = new Date().toISOString();
      const body = JSON.stringify({
        broadcaster: { user_id: 99, username: 'kickuser', channel_slug: 'kickuser' },
        is_live: true,
        viewer_count: 250,
      });
      const signed = new TextEncoder().encode(`kk-dyn-1.${nowIso}.${body}`);
      const sigBuf = new Uint8Array(
        await crypto.subtle.sign('Ed25519', kp.privateKey, signed),
      );
      const sigB64 = btoa(String.fromCharCode(...sigBuf));

      const res = await app.request(
        'https://radar.example.com/hooks/kick',
        {
          method: 'POST',
          headers: {
            'Kick-Event-Message-Id': 'kk-dyn-1',
            'Kick-Event-Message-Timestamp': nowIso,
            'Kick-Event-Signature': sigB64,
          },
          body,
        },
        env,
      );
      expect(res.status).toBe(200);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
