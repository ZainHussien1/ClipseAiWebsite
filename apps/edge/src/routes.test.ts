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
  } as unknown as D1Database;
}

describe('Phase 3 API routes (sources, feed, live, rising, claims)', () => {
  const teamDomain = 'clipse-test.cloudflareaccess.com';
  const issuer = `https://${teamDomain}`;
  const audience = 'clipse-test-aud';

  let privateKey: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;
  let sqlite: DatabaseSync;
  let emittedEvents: Array<{ workspaceId: string; eventType: string; payload: unknown }>;

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
    emittedEvents = [];
    const migrationsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'migrations',
    );
    for (const file of ['0001_init.sql', '0002_ingestion.sql', '0003_phase3.sql', '0004_phase4.sql', '0005_phase5.sql', '0006_v2_upgrade.sql', '0007_v3_board.sql', '0008_v4_alerts.sql']) {
      sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    }

    sqlite.exec(`
      INSERT INTO workspaces (id, slug, name, timezone) VALUES
        ('ws-alpha', 'alpha', 'Alpha Team', 'UTC'),
        ('ws-beta', 'beta', 'Beta Team', 'UTC');
      INSERT INTO memberships (id, workspace_id, user_id, email, role) VALUES
        ('mem-1', 'ws-alpha', 'user-alice', 'alice@example.com', 'Owner'),
        ('mem-2', 'ws-beta', 'user-bob', 'bob@example.com', 'Owner');
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
    let seq = 0;
    const workspaceDo = {
      idFromName(name: string) {
        return name as unknown as DurableObjectId;
      },
      get(id: DurableObjectId) {
        return {
          async emitEvent(eventType: string, payload: unknown) {
            seq += 1;
            emittedEvents.push({
              workspaceId: String(id),
              eventType,
              payload,
            });
            return { id: seq, type: eventType, payload, createdAt: new Date().toISOString() };
          },
        };
      },
    } as unknown as EdgeBindings['WORKSPACE_DO'];

    return {
      DB: createSqliteD1(sqlite),
      WORKSPACE_DO: workspaceDo,
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

  it('adds single & bulk sources, rejects SSRF, and enforces tenant isolation', async () => {
    const app = makeTestApp();
    const env = makeEnv();
    const aliceJwt = await signJwt('user-alice', 'alice@example.com');
    const bobJwt = await signJwt('user-bob', 'bob@example.com');

    // SSRF attempt rejected
    const ssrfRes = await app.request(
      'https://radar.example.com/api/v1/sources',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: 'http://169.254.169.254/latest/meta-data' }),
      },
      env,
    );
    expect(ssrfRes.status).toBe(400);

    // Single add
    const addRes = await app.request(
      'https://radar.example.com/api/v1/sources',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: 'https://www.youtube.com/@creatorone',
          starred: true,
          groupName: 'FPS',
          tags: ['fps', 'daily'],
        }),
      },
      env,
    );
    expect(addRes.status).toBe(201);
    const added = (await addRes.json()) as { source: { followId: string; starred: boolean } };
    expect(added.source.starred).toBe(true);

    // Bulk add with mixed valid and invalid lines
    const bulkRes = await app.request(
      'https://radar.example.com/api/v1/sources/bulk',
      {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rawLines: 'https://twitch.tv/shroud\nhttps://evil.example.com/bad\nhttps://kick.com/xqc',
          groupName: 'Variety',
        }),
      },
      env,
    );
    expect(bulkRes.status).toBe(201);
    const bulkBody = (await bulkRes.json()) as {
      added: unknown[];
      rejected: Array<{ input: string }>;
    };
    expect(bulkBody.added).toHaveLength(2);
    expect(bulkBody.rejected).toHaveLength(1);

    // Bob (ws-beta) cannot see or mutate Alice's source
    const bobList = await app.request(
      'https://radar.example.com/api/v1/sources',
      { headers: { 'Cf-Access-Jwt-Assertion': bobJwt } },
      env,
    );
    expect(bobList.status).toBe(200);
    expect(((await bobList.json()) as { sources: unknown[] }).sources).toHaveLength(0);

    const bobPatch = await app.request(
      `https://radar.example.com/api/v1/sources/${added.source.followId}`,
      {
        method: 'PATCH',
        headers: {
          'Cf-Access-Jwt-Assertion': bobJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paused: true }),
      },
      env,
    );
    expect(bobPatch.status).toBe(404);
  });

  it('paginates feed with keyset cursors (zero dupes/gaps) and serves live + rising', async () => {
    const app = makeTestApp();
    const env = makeEnv();
    const aliceJwt = await signJwt('user-alice', 'alice@example.com');
    const bobJwt = await signJwt('user-bob', 'bob@example.com');

    sqlite.exec(`
      INSERT INTO platform_accounts (id, platform, external_id, handle, display_name) VALUES
        ('acc-1', 'youtube', 'UC123', '@creator', 'Creator');
      INSERT INTO follows (id, workspace_id, account_id, starred, paused, archived) VALUES
        ('flw-1', 'ws-alpha', 'acc-1', 1, 0, 0);
      INSERT INTO items (id, account_id, platform, external_id, kind, title, url, published_at, first_seen_at) VALUES
        ('itm-1', 'acc-1', 'youtube', 'v1', 'video', 'Video 1', 'https://youtube.com/watch?v=v1', '2026-11-25T10:00:00.000Z', '2026-11-25T10:00:05.000Z'),
        ('itm-2', 'acc-1', 'youtube', 'v2', 'video', 'Video 2', 'https://youtube.com/watch?v=v2', '2026-11-25T11:00:00.000Z', '2026-11-25T11:00:05.000Z'),
        ('itm-3', 'acc-1', 'youtube', 'v3', 'video', 'Video 3', 'https://youtube.com/watch?v=v3', '2026-11-25T12:00:00.000Z', '2026-11-25T12:00:05.000Z'),
        ('itm-4', 'acc-1', 'youtube', 'v4', 'video', 'Video 4', 'https://youtube.com/watch?v=v4', '2026-11-25T13:00:00.000Z', '2026-11-25T13:00:05.000Z'),
        ('itm-5', 'acc-1', 'youtube', 'v5', 'live', 'Live 5', 'https://youtube.com/watch?v=v5', '2026-11-25T14:00:00.000Z', '2026-11-25T14:00:05.000Z');
      INSERT INTO live_samples (id, item_id, sampled_at, viewers, is_live) VALUES
        ('ls-1', 'itm-5', '2026-11-25T14:05:00.000Z', 4200, 1);
      INSERT INTO alerts (id, workspace_id, item_id, type, confidence, score, reason, evidence_json) VALUES
        ('al-1', 'ws-alpha', 'itm-4', 'breakout', 'high', 3.4, '3.4x this creator usual at 2h', '{"velocityRatio":3.4,"engagementRatio":1.5}');
    `);

    const p1 = await app.request(
      'https://radar.example.com/api/v1/feed?limit=2',
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    expect(p1.status).toBe(200);
    const b1 = (await p1.json()) as {
      items: Array<{ id: string; ingestLatencyMs: number }>;
      nextCursor: string | null;
    };
    expect(b1.items.map((x) => x.id)).toEqual(['itm-5', 'itm-4']);
    expect(b1.items[0]?.ingestLatencyMs).toBe(5000);
    expect(b1.nextCursor).toBeTruthy();

    const p2 = await app.request(
      `https://radar.example.com/api/v1/feed?limit=2&cursor=${encodeURIComponent(b1.nextCursor ?? '')}`,
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    const b2 = (await p2.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(b2.items.map((x) => x.id)).toEqual(['itm-3', 'itm-2']);

    const p3 = await app.request(
      `https://radar.example.com/api/v1/feed?limit=2&cursor=${encodeURIComponent(b2.nextCursor ?? '')}`,
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    const b3 = (await p3.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(b3.items.map((x) => x.id)).toEqual(['itm-1']);
    expect(b3.nextCursor).toBeNull();

    // Live & Rising
    const liveRes = await app.request(
      'https://radar.example.com/api/v1/live',
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    expect(((await liveRes.json()) as { streams: Array<{ viewers: number }> }).streams[0]?.viewers).toBe(4200);

    const risingRes = await app.request(
      'https://radar.example.com/api/v1/rising',
      { headers: { 'Cf-Access-Jwt-Assertion': aliceJwt } },
      env,
    );
    expect(((await risingRes.json()) as { items: Array<{ tier: string }> }).items[0]?.tier).toBe('breakout');

    // Bob (ws-beta) sees empty feed/live/rising
    const bobFeed = await app.request(
      'https://radar.example.com/api/v1/feed',
      { headers: { 'Cf-Access-Jwt-Assertion': bobJwt } },
      env,
    );
    expect(((await bobFeed.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('enforces atomic claim overlap checks (whole-item & range), state transitions, and IDOR', async () => {
    const app = makeTestApp();
    const env = makeEnv();
    const aliceJwt = await signJwt('user-alice', 'alice@example.com');
    const bobJwt = await signJwt('user-bob', 'bob@example.com');

    sqlite.exec(`
      INSERT INTO platform_accounts (id, platform, external_id, handle, display_name) VALUES
        ('acc-1', 'twitch', 'shroud', 'shroud', 'Shroud');
      INSERT INTO items (id, account_id, platform, external_id, kind, title, url, published_at) VALUES
        ('itm-1', 'acc-1', 'twitch', 's1', 'vod', 'VOD 1', 'https://twitch.tv/videos/1', '2026-11-25T10:00:00.000Z'),
        ('itm-2', 'acc-1', 'twitch', 's2', 'vod', 'VOD 2', 'https://twitch.tv/videos/2', '2026-11-25T11:00:00.000Z');
    `);

    const postClaim = (jwt: string, body: unknown) =>
      app.request(
        'https://radar.example.com/api/v1/claims',
        {
          method: 'POST',
          headers: {
            'Cf-Access-Jwt-Assertion': jwt,
            Origin: 'https://radar.example.com',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        env,
      );

    // Range [10, 40) succeeds
    const r1 = await postClaim(aliceJwt, { itemId: 'itm-1', startSec: 10, endSec: 40 });
    expect(r1.status).toBe(201);
    const c1 = (await r1.json()) as { claim: { id: string; status: string }; eventId: number };
    expect(c1.claim.status).toBe('Claimed');
    expect(c1.eventId).toBe(1);
    expect(emittedEvents).toHaveLength(1);

    // Overlapping range [30, 60) -> 409 Conflict
    const overlap = await postClaim(aliceJwt, { itemId: 'itm-1', startSec: 30, endSec: 60 });
    expect(overlap.status).toBe(409);

    // Whole-item claim on itm-1 -> 409 Conflict
    const wholeConflict = await postClaim(aliceJwt, { itemId: 'itm-1' });
    expect(wholeConflict.status).toBe(409);

    // Adjacent non-overlapping [40, 70) -> 201 Created
    const adjacent = await postClaim(aliceJwt, { itemId: 'itm-1', startSec: 40, endSec: 70 });
    expect(adjacent.status).toBe(201);

    // Whole-item claim on itm-2 -> 201 Created, then range on itm-2 -> 409 Conflict
    const wholeOk = await postClaim(aliceJwt, { itemId: 'itm-2' });
    expect(wholeOk.status).toBe(201);
    const rangeAfterWhole = await postClaim(aliceJwt, { itemId: 'itm-2', startSec: 0, endSec: 15 });
    expect(rangeAfterWhole.status).toBe(409);

    // Bob (ws-beta) cannot mutate Alice's claim (404), but can claim itm-1 in ws-beta
    const bobPatch = await app.request(
      `https://radar.example.com/api/v1/claims/${c1.claim.id}`,
      {
        method: 'PATCH',
        headers: {
          'Cf-Access-Jwt-Assertion': bobJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'Clipped' }),
      },
      env,
    );
    expect(bobPatch.status).toBe(404);

    const bobClaim = await postClaim(bobJwt, { itemId: 'itm-1', startSec: 10, endSec: 40 });
    expect(bobClaim.status).toBe(201);

    // Alice transitions Claimed -> Clipped -> Skipped, then [10, 40) can be claimed again
    const patchClipped = await app.request(
      `https://radar.example.com/api/v1/claims/${c1.claim.id}`,
      {
        method: 'PATCH',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'Clipped' }),
      },
      env,
    );
    expect(patchClipped.status).toBe(200);

    const patchSkipped = await app.request(
      `https://radar.example.com/api/v1/claims/${c1.claim.id}`,
      {
        method: 'PATCH',
        headers: {
          'Cf-Access-Jwt-Assertion': aliceJwt,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'Skipped' }),
      },
      env,
    );
    expect(patchSkipped.status).toBe(200);

    const reclaim = await postClaim(aliceJwt, { itemId: 'itm-1', startSec: 10, endSec: 40 });
    expect(reclaim.status).toBe(201);
  });
});
