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
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      const out: unknown[] = [];
      for (const s of statements) {
        out.push(await s.run());
      }
      return out;
    },
  } as unknown as D1Database;
}

describe('Phase 5 routes (clips, ROI, scorecard, daily report, export, settings)', () => {
  const teamDomain = 'clipse-test.cloudflareaccess.com';
  const issuer = `https://${teamDomain}`;
  const audience = 'clipse-test-aud';

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
        ('acc-src', 'twitch', 'shroud', 'shroud', 'Shroud'),
        ('acc-own', 'youtube', 'UCOWN123', '@ourclips', 'Our Clips');
      INSERT INTO follows (id, workspace_id, account_id, starred, is_own) VALUES
        ('flw-src', 'ws-alpha', 'acc-src', 1, 0),
        ('flw-own', 'ws-alpha', 'acc-own', 0, 1);
      INSERT INTO items (id, account_id, platform, external_id, kind, title, url, published_at, first_seen_at) VALUES
        ('itm-src', 'acc-src', 'twitch', 's1', 'vod', 'Source VOD', 'https://twitch.tv/videos/999', '2026-11-25T10:00:00.000Z', '2026-11-25T10:00:04.000Z'),
        ('itm-own', 'acc-own', 'youtube', 'yt1', 'short', 'Our Short', 'https://youtube.com/shorts/abc', '2026-11-25T12:00:00.000Z', '2026-11-25T12:00:02.000Z');
      INSERT INTO alerts (id, workspace_id, item_id, type, confidence, score, reason, created_at) VALUES
        ('al-1', 'ws-alpha', 'itm-src', 'rising', 'medium', 2.4, '2.4x usual', '2026-11-25T11:00:00.000Z');
      INSERT INTO claims (id, workspace_id, item_id, user_id, status, created_at) VALUES
        ('clm-1', 'ws-alpha', 'itm-src', 'user-alice', 'Clipped', '2026-11-25T11:05:00.000Z');
      INSERT INTO ingestion_metrics (id, platform, metric_date, pushes_received, missed_pushes, reconcile_runs) VALUES
        ('im-1', 'twitch', '2026-11-25', 19, 1, 2);
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

  it('prefills own-channel uploads, auto-links exact description URL, and labels manual stats', async () => {
    const app = makeTestApp();
    const env = makeEnv();
    const aliceJwt = await signJwt('user-alice', 'alice@example.com');

    // Prefill lists own upload
    const list1 = await app.request(
      'https://radar.example.com/api/v1/clips',
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    expect(list1.status).toBe(200);
    const listBody1 = (await list1.json()) as {
      ownUploads: Array<{ itemId: string; url: string }>;
    };
    expect(listBody1.ownUploads).toHaveLength(1);
    expect(listBody1.ownUploads[0]?.url).toBe('https://youtube.com/shorts/abc');

    // Clip with exact source URL in description auto-links (needsConfirmation = false)
    const autoRes = await app.request(
      'https://radar.example.com/api/v1/clips',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://tiktok.com/@ourclips/video/1',
          platform: 'tiktok',
          title: 'Auto-linked clip',
          description: 'Clipped from https://twitch.tv/videos/999',
          manualStats: { views: 15000, likes: 1200 },
        }),
      },
      env,
    );
    expect(autoRes.status).toBe(201);
    const autoBody = (await autoRes.json()) as {
      clip: {
        id: string;
        sourceItemId: string | null;
        needsConfirmation: boolean;
        statsSource: string | null;
        views: number | null;
      };
    };
    expect(autoBody.clip.sourceItemId).toBe('itm-src');
    expect(autoBody.clip.needsConfirmation).toBe(false);
    expect(autoBody.clip.statsSource).toBe('manual');
    expect(autoBody.clip.views).toBe(15000);

    // Clip without match needs confirmation, then confirm-link resolves it
    const unlinkedRes = await app.request(
      'https://radar.example.com/api/v1/clips',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://youtube.com/shorts/abc',
          platform: 'youtube',
          title: 'Own short',
        }),
      },
      env,
    );
    const unlinkedBody = (await unlinkedRes.json()) as {
      clip: { id: string; needsConfirmation: boolean };
    };
    expect(unlinkedBody.clip.needsConfirmation).toBe(true);

    const confirmRes = await app.request(
      `https://radar.example.com/api/v1/clips/${unlinkedBody.clip.id}/confirm-link`,
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sourceItemId: 'itm-own' }),
      },
      env,
    );
    expect(confirmRes.status).toBe(200);
    expect(await confirmRes.json()).toMatchObject({
      ok: true,
      sourceItemId: 'itm-own',
      needsConfirmation: false,
    });
  });

  it('enforces sample floors on ROI/scorecard, Admin+ on scorecard, and computes TZ daily report', async () => {
    const app = makeTestApp();
    const env = makeEnv();
    const aliceJwt = await signJwt('user-alice', 'alice@example.com');
    const memberJwt = await signJwt('user-member', 'member@example.com');

    // ROI below sample floor
    const roiRes = await app.request(
      'https://radar.example.com/api/v1/roi',
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    expect(roiRes.status).toBe(200);
    const roiBody = (await roiRes.json()) as {
      roi: Array<{ status: string; clipsPerClaim: number | null }>;
    };
    expect(roiBody.roi[0]?.status).toBe('not enough data yet');
    expect(roiBody.roi[0]?.clipsPerClaim).toBeNull();

    // Scorecard forbidden for Member
    const memberScore = await app.request(
      'https://radar.example.com/api/v1/admin/scorecard',
      { headers: { 'Cf-Access-Jwt-Assertion': memberJwt } },
      env,
    );
    expect(memberScore.status).toBe(403);

    // Scorecard for Owner shows sample floor + real telemetry
    const ownerScore = await app.request(
      'https://radar.example.com/api/v1/admin/scorecard',
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    expect(ownerScore.status).toBe(200);
    const scoreBody = (await ownerScore.json()) as {
      rising: { status: string; precision: number | null };
      missedPushRate: number | null;
      avgTimeToAlertMs: number | null;
    };
    expect(scoreBody.rising.status).toBe('not enough data yet');
    expect(scoreBody.rising.precision).toBeNull();
    expect(scoreBody.missedPushRate).toBe(0.05);
    expect(scoreBody.avgTimeToAlertMs).toBe(4000);

    // Daily report for 2026-11-25
    const dailyRes = await app.request(
      'https://radar.example.com/api/v1/reports/daily?date=2026-11-25',
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    expect(dailyRes.status).toBe(200);
    const dailyBody = (await dailyRes.json()) as {
      aiInsightsUsed: boolean;
      teamSummary: { alertsCount: number; claimsCount: number; clippedCount: number };
    };
    expect(dailyBody.aiInsightsUsed).toBe(false);
    expect(dailyBody.teamSummary).toEqual({
      alertsCount: 1,
      claimsCount: 1,
      clippedCount: 1,
      clipsLoggedCount: 0,
    });
  });

  it('exports workspace-only JSON/CSV and atomically deletes workspace for Owner only', async () => {
    const app = makeTestApp();
    const env = makeEnv();
    const aliceJwt = await signJwt('user-alice', 'alice@example.com');
    const memberJwt = await signJwt('user-member', 'member@example.com');
    const bobJwt = await signJwt('user-bob', 'bob@example.com');

    // JSON export contains ws-alpha only
    const jsonExport = await app.request(
      'https://radar.example.com/api/v1/export',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ format: 'json' }),
      },
      env,
    );
    expect(jsonExport.status).toBe(200);
    const exported = (await jsonExport.json()) as { workspaceId: string; workspaces: Array<{ id: string }> };
    expect(exported.workspaceId).toBe('ws-alpha');
    expect(exported.workspaces.map((w) => w.id)).toEqual(['ws-alpha']);

    // CSV export
    const csvExport = await app.request(
      'https://radar.example.com/api/v1/export',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ format: 'csv' }),
      },
      env,
    );
    expect(csvExport.status).toBe(200);
    expect(csvExport.headers.get('Content-Type')).toContain('text/csv');

    // Member cannot delete workspace
    const memberDel = await app.request(
      'https://radar.example.com/api/v1/settings/workspace',
      {
        method: 'DELETE',
        headers: {
          'Cf-Access-Jwt-Assertion': memberJwt,
          Origin: 'https://radar.example.com',
        },
      },
      env,
    );
    expect(memberDel.status).toBe(403);

    // Owner deletes ws-alpha; ws-beta remains intact
    const ownerDel = await app.request(
      'https://radar.example.com/api/v1/settings/workspace',
      {
        method: 'DELETE',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
        },
      },
      env,
    );
    expect(ownerDel.status).toBe(200);

    const bobMe = await app.request(
      'https://radar.example.com/api/v1/me',
      { headers: { 'Cf-Access-Jwt-Assertion': bobJwt } },
      env,
    );
    expect(bobMe.status).toBe(200);
  });
});
