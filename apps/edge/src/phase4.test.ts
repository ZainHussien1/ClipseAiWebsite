import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// @ts-expect-error node:sqlite is built-in in Node 22+
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
} from 'jose';
import { createApp, type EdgeBindings } from './app.js';
import { CloudflareAccessAuthProvider } from './auth.js';
import { decryptSecret } from './crypto.js';

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

describe('Phase 4 edge routes (alerts, votes, notifications, prefs, push, discord)', () => {
  const teamDomain = 'clipse-test.cloudflareaccess.com';
  const issuer = `https://${teamDomain}`;
  const audience = 'clipse-test-aud';
  const encryptionKey = 'test-encryption-key-material-32chars';

  let privateKey: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;
  let sqlite: DatabaseSync;

  beforeAll(async () => {
    const kp = await generateKeyPair('RS256');
    privateKey = kp.privateKey;
    const publicJwk: JWK = await exportJWK(kp.publicKey);
    publicJwk.kid = 'test-key-1';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    jwks = createLocalJWKSet({ keys: [publicJwk] });
  });

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
      '0007_v3_board.sql',
      '0008_v4_alerts.sql',
    ]) {
      sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    }

    sqlite.exec(`
      INSERT INTO workspaces (id, slug, name, timezone) VALUES
        ('ws-alpha', 'alpha', 'Alpha Team', 'UTC'),
        ('ws-beta', 'beta', 'Beta Team', 'UTC');
      INSERT INTO memberships (id, workspace_id, user_id, email, role) VALUES
        ('mem-1', 'ws-alpha', 'user-alice', 'alice@example.com', 'Owner'),
        ('mem-2', 'ws-alpha', 'user-member', 'member@example.com', 'Member'),
        ('mem-3', 'ws-beta', 'user-bob', 'bob@example.com', 'Owner');
      INSERT INTO platform_accounts (id, platform, external_id, handle, display_name) VALUES
        ('acc-1', 'twitch', 'shroud', 'shroud', 'Shroud');
      INSERT INTO items (id, account_id, platform, external_id, kind, title, url, published_at) VALUES
        ('itm-1', 'acc-1', 'twitch', 's1', 'live', 'Live Stream', 'https://twitch.tv/shroud', '2026-11-25T10:00:00.000Z');
      INSERT INTO alerts (id, workspace_id, item_id, type, confidence, score, reason, evidence_json) VALUES
        ('al-alpha', 'ws-alpha', 'itm-1', 'live_moment', 'high', 4.2, '5 clips from 4 viewers', '{"clips":5}');
      INSERT INTO notifications (id, workspace_id, user_id, alert_id, tier, channel, title, body) VALUES
        ('ntf-alice', 'ws-alpha', 'user-alice', 'al-alpha', 'P1', 'in_app', 'Live Moment', '5 clips from 4 viewers');
    `);
  });

  async function signJwt(sub: string, email: string): Promise<string> {
    return new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setSubject(sub)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
  }

  function makeEnv(): EdgeBindings {
    return {
      DB: createSqliteD1(sqlite),
      WORKSPACE_DO: {} as unknown as EdgeBindings['WORKSPACE_DO'],
      ENVIRONMENT: 'local',
      AI_INSIGHTS_ENABLED: 'false',
      ACCESS_TEAM_DOMAIN: teamDomain,
      ACCESS_AUD: audience,
      WEBHOOK_ENCRYPTION_KEY: encryptionKey,
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

  it('persists useful/not-useful alert votes and enforces cross-tenant IDOR isolation', async () => {
    const app = makeTestApp();
    const env = makeEnv();
    const aliceJwt = await signJwt('user-alice', 'alice@example.com');
    const bobJwt = await signJwt('user-bob', 'bob@example.com');

    // Alice votes useful=true then flips to useful=false
    const v1 = await app.request(
      'https://radar.example.com/api/v1/alerts/al-alpha/vote',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ useful: true }),
      },
      env,
    );
    expect(v1.status).toBe(200);

    const v2 = await app.request(
      'https://radar.example.com/api/v1/alerts/al-alpha/vote',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ useful: false }),
      },
      env,
    );
    expect(v2.status).toBe(200);

    const listRes = await app.request(
      'https://radar.example.com/api/v1/alerts',
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    const listBody = (await listRes.json()) as {
      alerts: Array<{ id: string; userVote: boolean | null }>;
    };
    expect(listBody.alerts).toHaveLength(1);
    expect(listBody.alerts[0]?.userVote).toBe(false);

    // Bob (ws-beta) cannot vote on or see ws-alpha's alert
    const bobVote = await app.request(
      'https://radar.example.com/api/v1/alerts/al-alpha/vote',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': bobJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ useful: true }),
      },
      env,
    );
    expect(bobVote.status).toBe(404);
  });

  it('persists notification prefs, snooze, read state, and push subscriptions with IDOR checks', async () => {
    const app = makeTestApp();
    const env = makeEnv();
    const aliceJwt = await signJwt('user-alice', 'alice@example.com');
    const memberJwt = await signJwt('user-member', 'member@example.com');

    const prefsRes = await app.request(
      'https://radar.example.com/api/v1/notifications/prefs',
      {
        method: 'PUT',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hourlyBudget: 5,
          quietStartHour: 23,
          quietEndHour: 7,
          timezone: 'America/New_York',
          snoozeUntil: '2026-11-26T12:00:00.000Z',
        }),
      },
      env,
    );
    expect(prefsRes.status).toBe(200);

    // Member cannot mark Alice's notification as read
    const memberRead = await app.request(
      'https://radar.example.com/api/v1/notifications/ntf-alice/read',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': memberJwt,
          Origin: 'https://radar.example.com',
        },
      },
      env,
    );
    expect(memberRead.status).toBe(404);

    // Alice marks her notification read
    const aliceRead = await app.request(
      'https://radar.example.com/api/v1/notifications/ntf-alice/read',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
        },
      },
      env,
    );
    expect(aliceRead.status).toBe(200);

    // Push subscription requires https://
    const badPush = await app.request(
      'https://radar.example.com/api/v1/notifications/push',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          endpoint: 'http://push.example.com/sub/1',
          keys: { p256dh: 'B'.repeat(24), auth: 'A'.repeat(16) },
        }),
      },
      env,
    );
    expect(badPush.status).toBe(400);

    const okPush = await app.request(
      'https://radar.example.com/api/v1/notifications/push',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
          keys: { p256dh: 'B'.repeat(24), auth: 'A'.repeat(16) },
        }),
      },
      env,
    );
    expect(okPush.status).toBe(201);
  });

  it('rejects non-Discord webhook hosts, requires Admin+ role, and encrypts webhook at rest', async () => {
    const app = makeTestApp();
    const env = makeEnv();
    const aliceJwt = await signJwt('user-alice', 'alice@example.com');
    const memberJwt = await signJwt('user-member', 'member@example.com');

    // Member (non-Admin) rejected with 403
    const memberPut = await app.request(
      'https://radar.example.com/api/v1/notifications/discord',
      {
        method: 'PUT',
        headers: {
          'Cf-Access-Jwt-Assertion': memberJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhookUrl:
            'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz1234',
        }),
      },
      env,
    );
    expect(memberPut.status).toBe(403);

    // Invalid host rejected with 400 (SSRF guard)
    const badHost = await app.request(
      'https://radar.example.com/api/v1/notifications/discord',
      {
        method: 'PUT',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhookUrl: 'https://evil.example.com/api/webhooks/123456789012345678/token1234567890123456',
        }),
      },
      env,
    );
    expect(badHost.status).toBe(400);

    // Valid Discord webhook stored encrypted via AES-GCM
    const validUrl =
      'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz1234';
    const okPut = await app.request(
      'https://radar.example.com/api/v1/notifications/discord',
      {
        method: 'PUT',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ webhookUrl: validUrl }),
      },
      env,
    );
    expect(okPut.status).toBe(200);
    expect(await okPut.json()).toEqual({ ok: true, discordConfigured: true });

    const row = sqlite
      .prepare('SELECT discord_webhook_enc FROM workspaces WHERE id = ?')
      .get('ws-alpha') as { discord_webhook_enc: string };
    expect(row.discord_webhook_enc).toMatch(/^v1\./);
    expect(row.discord_webhook_enc).not.toContain('discord.com');
    expect(await decryptSecret(row.discord_webhook_enc, encryptionKey)).toBe(validUrl);
  });
});
