import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// @ts-expect-error node:sqlite is built-in in Node 22+
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type EdgeBindings } from './app.js';

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

describe('V1 hardening: OTP/PBKDF2 auth, Viewer 403, and F-01..F-13 truthfulness', () => {
  let sqlite: DatabaseSync;
  const sessionSecret = 'v1-hardening-session-secret-32chars';

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
  });

  function makeEnv(overrides: Partial<EdgeBindings> = {}): EdgeBindings {
    return {
      DB: createSqliteD1(sqlite),
      WORKSPACE_DO: {} as unknown as EdgeBindings['WORKSPACE_DO'],
      ENVIRONMENT: 'staging',
      AI_INSIGHTS_ENABLED: 'false',
      SESSION_SECRET: sessionSecret,
      ...overrides,
    };
  }

  it('rejects bare email, issues generic request-code, verifies 6-digit OTP once, and supports PBKDF2 passphrase', async () => {
    const app = createApp();
    let capturedWebhookContent = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.body && typeof init.body === 'string') {
        const parsed = JSON.parse(init.body) as { content?: string };
        capturedWebhookContent = parsed.content ?? '';
      }
      return new Response(null, { status: 204 });
    });

    const env = makeEnv({
      DISCORD_WEBHOOK_URL:
        'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz1234',
    });

    try {
      // Bare email rejected on /login
      const bareLogin = await app.request(
        'https://radar.example.com/api/v1/auth/login',
        {
          method: 'POST',
          headers: { Origin: 'https://radar.example.com', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'owner@example.com' }),
        },
        env,
      );
      expect(bareLogin.status).toBe(401);

      // Request OTP for first owner -> generic 200 and sends masked code to Discord
      const reqCode = await app.request(
        'https://radar.example.com/api/v1/auth/request-code',
        {
          method: 'POST',
          headers: { Origin: 'https://radar.example.com', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'owner@example.com' }),
        },
        env,
      );
      expect(reqCode.status).toBe(200);
      expect(capturedWebhookContent).toContain('ow***@example.com');
      const codeMatch = /\*\*(\d{6})\*\*/.exec(capturedWebhookContent);
      expect(codeMatch).toBeTruthy();
      const otpCode = codeMatch?.[1] ?? '';

      // Login with 6-digit OTP creates workspace -> 201
      const otpLogin = await app.request(
        'https://radar.example.com/api/v1/auth/login',
        {
          method: 'POST',
          headers: { Origin: 'https://radar.example.com', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'owner@example.com',
            workspaceName: 'Studio V1',
            code: otpCode,
          }),
        },
        env,
      );
      expect(otpLogin.status).toBe(201);
      const cookiePair = (otpLogin.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

      // Reusing same OTP fails with 401
      const reuseRes = await app.request(
        'https://radar.example.com/api/v1/auth/login',
        {
          method: 'POST',
          headers: { Origin: 'https://radar.example.com', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'owner@example.com', code: otpCode }),
        },
        env,
      );
      expect(reuseRes.status).toBe(401);

      // Request-code for unknown email returns identical generic 200 (zero enumeration) and sends no webhook
      capturedWebhookContent = '';
      const unknownReq = await app.request(
        'https://radar.example.com/api/v1/auth/request-code',
        {
          method: 'POST',
          headers: { Origin: 'https://radar.example.com', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'stranger@example.com' }),
        },
        env,
      );
      expect(unknownReq.status).toBe(200);
      expect(capturedWebhookContent).toBe('');

      // Set PBKDF2 passphrase while authenticated
      const setPass = await app.request(
        'https://radar.example.com/api/v1/auth/passphrase',
        {
          method: 'POST',
          headers: {
            Cookie: cookiePair,
            Origin: 'https://radar.example.com',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ passphrase: 'my-secret-passphrase' }),
        },
        env,
      );
      expect(setPass.status).toBe(200);

      // Wrong passphrase fails with 401, correct passphrase succeeds with 200
      const wrongPass = await app.request(
        'https://radar.example.com/api/v1/auth/login',
        {
          method: 'POST',
          headers: { Origin: 'https://radar.example.com', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'owner@example.com', passphrase: 'wrong-passphrase-1' }),
        },
        env,
      );
      expect(wrongPass.status).toBe(401);

      const goodPass = await app.request(
        'https://radar.example.com/api/v1/auth/login',
        {
          method: 'POST',
          headers: { Origin: 'https://radar.example.com', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'owner@example.com', passphrase: 'my-secret-passphrase' }),
        },
        env,
      );
      expect(goodPass.status).toBe(200);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('enforces Viewer role 403 on write routes and verifies F-02..F-13 truthfulness', async () => {
    const app = createApp();
    const env = makeEnv();

    // Seed workspace, Owner + Viewer + Member, and items (one backfill, one live-ingested with null likes/comments)
    sqlite.exec(`
      INSERT INTO workspaces (id, slug, name, timezone) VALUES ('ws-1', 'ws1', 'Studio', 'UTC');
      INSERT INTO memberships (id, workspace_id, user_id, email, role) VALUES
        ('m-owner', 'ws-1', 'u-owner', 'owner@example.com', 'Owner'),
        ('m-viewer', 'ws-1', 'u-viewer', 'viewer@example.com', 'Viewer');
      INSERT INTO platform_accounts (id, platform, external_id, handle, display_name) VALUES
        ('acct:youtube:UC123', 'youtube', 'UC123', '@@mrbeast', 'MrBeast');
      INSERT INTO follows (id, workspace_id, account_id, starred) VALUES
        ('flw-1', 'ws-1', 'acct:youtube:UC123', 1);
      INSERT INTO items (id, account_id, platform, external_id, kind, title, url, published_at, first_seen_at, is_backfill) VALUES
        ('item-backfill', 'acct:youtube:UC123', 'youtube', 'v-old', 'video', 'Old Video', 'https://youtube.com/watch?v=v-old', '2026-10-01T00:00:00Z', '2026-11-26T00:00:00Z', 1),
        ('item-fresh', 'acct:youtube:UC123', 'youtube', 'v-new', 'video', 'Fresh Video', 'https://youtube.com/watch?v=v-new', '2026-11-26T10:00:00Z', '2026-11-26T10:00:05Z', 0),
        ('item-live', 'acct:youtube:UC123', 'youtube', 'v-live', 'live', 'Live Stream', 'https://youtube.com/watch?v=v-live', '2026-11-26T10:00:00Z', '2026-11-26T10:00:02Z', 0);
      INSERT INTO item_stats (id, item_id, captured_at, views, likes, comments) VALUES
        ('st-1', 'item-fresh', '2026-11-26T10:05:00Z', 10000, NULL, NULL);
      INSERT INTO live_samples (id, item_id, sampled_at, viewers, is_live) VALUES
        ('ls-1', 'item-live', '2026-11-26T10:05:00Z', 1200, 1);
      INSERT INTO alerts (id, workspace_id, item_id, type, confidence, score, reason, evidence_json, created_at) VALUES
        ('al-old', 'ws-1', 'item-backfill', 'rising', 'low', 2.0, 'backfill', '{"velocityRatio":2.0}', '2026-11-26T00:00:00Z'),
        ('al-new', 'ws-1', 'item-fresh', 'breakout', 'medium', 3.5, '3.5x usual (engagement n/a)', '{"velocityRatio":3.5,"engagementRatio":null}', '2026-11-26T10:05:00Z');
    `);

    // Give viewer & owner OTPs to sign in
    const { hashOtpCode } = await import('./session.js');
    const nowIso = new Date().toISOString();
    const expIso = new Date(Date.now() + 600_000).toISOString();
    sqlite
      .prepare('INSERT INTO auth_otps (id, email, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run('otp-v', 'viewer@example.com', await hashOtpCode('111111'), expIso, nowIso);
    sqlite
      .prepare('INSERT INTO auth_otps (id, email, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run('otp-o', 'owner@example.com', await hashOtpCode('222222'), expIso, nowIso);

    const vLogin = await app.request(
      'https://radar.example.com/api/v1/auth/login',
      {
        method: 'POST',
        headers: { Origin: 'https://radar.example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'viewer@example.com', code: '111111' }),
      },
      env,
    );
    const viewerCookie = (vLogin.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

    const oLogin = await app.request(
      'https://radar.example.com/api/v1/auth/login',
      {
        method: 'POST',
        headers: { Origin: 'https://radar.example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.com', code: '222222' }),
      },
      env,
    );
    const ownerCookie = (oLogin.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

    // Viewer gets 403 on write routes
    const viewerPostClaim = await app.request(
      'https://radar.example.com/api/v1/claims',
      {
        method: 'POST',
        headers: {
          Cookie: viewerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemId: 'item-fresh' }),
      },
      env,
    );
    expect(viewerPostClaim.status).toBe(403);

    // Owner claims item-fresh (F-13)
    const ownerClaim = await app.request(
      'https://radar.example.com/api/v1/claims',
      {
        method: 'POST',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemId: 'item-fresh' }),
      },
      env,
    );
    expect(ownerClaim.status).toBe(201);
    const claimId = ((await ownerClaim.json()) as { claim: { id: string } }).claim.id;

    // F-02, F-03, F-04, F-12, F-13 on /api/v1/feed
    const feedRes = await app.request(
      'https://radar.example.com/api/v1/feed',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    const feedBody = (await feedRes.json()) as {
      source: string;
      items: Array<{
        id: string;
        accountHandle: string;
        isBackfill: boolean;
        durationSec: number | null;
        latestLikes: number | null;
        latestComments: number | null;
        source: string;
        claim: { id: string; email: string | null; claimedByMe: boolean } | null;
      }>;
    };
    expect(feedBody.source).toBe('YouTube RSS');
    const freshItem = feedBody.items.find((i) => i.id === 'item-fresh');
    expect(freshItem?.accountHandle).toBe('@mrbeast');
    expect(freshItem?.latestLikes).toBeNull();
    expect(freshItem?.latestComments).toBeNull();
    expect(freshItem?.durationSec).toBeNull();
    expect(freshItem?.isBackfill).toBe(false);
    expect(freshItem?.claim).toMatchObject({
      id: claimId,
      email: 'owner@example.com',
      claimedByMe: true,
    });

    // F-04: Rising excludes backfill & preserves null engagementRatio
    const risingRes = await app.request(
      'https://radar.example.com/api/v1/rising',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    const risingBody = (await risingRes.json()) as {
      items: Array<{ itemId: string; engagementRatio: number | null; snapshots?: number[] }>;
    };
    expect(risingBody.items.map((x) => x.itemId)).toEqual(['item-fresh']);
    expect(risingBody.items[0]?.engagementRatio).toBeNull();
    expect(risingBody.items[0]?.snapshots).toBeUndefined();

    // F-04: Scorecard excludes backfill from avgTimeToAlertMs (fresh is 5000ms, not millions)
    const scoreRes = await app.request(
      'https://radar.example.com/api/v1/admin/scorecard',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    const scoreBody = (await scoreRes.json()) as { avgTimeToAlertMs: number | null };
    expect(scoreBody.avgTimeToAlertMs).toBe(5000);

    // F-05 / F-06: Health & Live
    const healthRes = await app.request('https://radar.example.com/api/v1/health', {}, env);
    expect(await healthRes.json()).toMatchObject({
      status: 'ok',
      providers: { youtube: 'YouTube RSS' },
      lastIngestAt: '2026-11-26T10:00:05Z',
    });

    const liveRes = await app.request(
      'https://radar.example.com/api/v1/live',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(await liveRes.json()).toMatchObject({
      liveCount: 1,
      source: 'YouTube RSS',
    });

    // Owner can unclaim (DELETE /api/v1/claims/:id)
    const delClaim = await app.request(
      `https://radar.example.com/api/v1/claims/${claimId}`,
      {
        method: 'DELETE',
        headers: { Cookie: ownerCookie, Origin: 'https://radar.example.com' },
      },
      env,
    );
    expect(delClaim.status).toBe(200);
  });
});
