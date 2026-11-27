import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// @ts-expect-error node:sqlite is built-in in Node 22+
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('V3 Discover, Mission Control, Saved Views, and Kanban Work Board', () => {
  let sqlite: DatabaseSync;
  const sessionSecret = 'v3-discover-board-secret-32-chars';
  let wsEvents: Array<{ workspaceId: string; eventType: string; payload: unknown }>;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    wsEvents = [];
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
    ]) {
      sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    }

    const nowIso = new Date().toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const tenHoursAgo = new Date(Date.now() - 10 * 3_600_000).toISOString();

    sqlite.exec(`
      INSERT INTO workspaces (id, slug, name, timezone) VALUES
        ('ws-1', 'ws1', 'Studio 1', 'UTC'),
        ('ws-2', 'ws2', 'Studio 2', 'UTC');
      INSERT INTO memberships (id, workspace_id, user_id, email, role) VALUES
        ('m-1', 'ws-1', 'u-1', 'editor1@example.com', 'Owner'),
        ('m-2', 'ws-1', 'u-2', 'editor2@example.com', 'Member'),
        ('m-3', 'ws-2', 'u-3', 'other@example.com', 'Owner');
      INSERT INTO platform_accounts (id, platform, external_id, handle, display_name) VALUES
        ('acct:youtube:UC1', 'youtube', 'UC1', '@creator1', 'Creator One');
      INSERT INTO follows (id, workspace_id, account_id, starred) VALUES
        ('flw-1', 'ws-1', 'acct:youtube:UC1', 1);
      INSERT INTO items (id, account_id, platform, external_id, kind, shorts_classification, title, url, thumbnail_url, published_at, first_seen_at, is_backfill, duration_sec) VALUES
        ('itm-vid', 'acct:youtube:UC1', 'youtube', 'v1', 'video', 'video', 'Full Documentary', 'https://youtube.com/watch?v=v1', 'https://i.ytimg.com/vi/v1/hqdefault.jpg', '${twoHoursAgo}', '${twoHoursAgo}', 0, 900),
        ('itm-short', 'acct:youtube:UC1', 'youtube', 's1', 'short', 'short', 'Quick Clip #shorts', 'https://youtube.com/shorts/s1', 'https://i.ytimg.com/vi/s1/hqdefault.jpg', '${tenHoursAgo}', '${tenHoursAgo}', 0, 45),
        ('itm-live', 'acct:youtube:UC1', 'youtube', 'l1', 'live', 'live', 'Live Event', 'https://youtube.com/watch?v=l1', 'https://i.ytimg.com/vi/l1/hqdefault.jpg', '${nowIso}', '${nowIso}', 0, NULL),
        ('itm-uncl', 'acct:youtube:UC1', 'youtube', 'u1', 'video', 'unclassified', 'Unknown Duration Item', 'https://youtube.com/watch?v=u1', NULL, '${tenHoursAgo}', '${tenHoursAgo}', 0, NULL);
      INSERT INTO item_stats (id, item_id, captured_at, views, likes, comments) VALUES
        ('st-vid', 'itm-vid', '${nowIso}', 25000, 1200, 80),
        ('st-short', 'itm-short', '${nowIso}', 80000, NULL, NULL);
      INSERT INTO live_samples (id, item_id, sampled_at, viewers, is_live) VALUES
        ('ls-1', 'itm-live', '${nowIso}', 5400, 1);
      INSERT INTO alerts (id, workspace_id, item_id, type, confidence, score, reason, created_at) VALUES
        ('al-1', 'ws-1', 'itm-vid', 'breakout', 'high', 4.1, '4.1x usual', '${nowIso}');
    `);
  });

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
            wsEvents.push({ workspaceId: String(id), eventType, payload });
            return { id: seq, type: eventType, payload, createdAt: new Date().toISOString() };
          },
        };
      },
    } as unknown as EdgeBindings['WORKSPACE_DO'];

    return {
      DB: createSqliteD1(sqlite),
      WORKSPACE_DO: workspaceDo,
      ENVIRONMENT: 'staging',
      AI_INSIGHTS_ENABLED: 'false',
      SESSION_SECRET: sessionSecret,
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

  it('supports 3-lane Discover filtering, laneCounts, creatorsRail, mark-seen, item detail, and saved views', async () => {
    const app = createApp();
    const env = makeEnv();
    const c1 = await loginAs(app, env, 'editor1@example.com', '111111');
    const cOther = await loginAs(app, env, 'other@example.com', '333333');

    // Feed returns laneCounts + creatorsRail
    const allRes = await app.request(
      'https://radar.example.com/api/v1/feed',
      { headers: { Cookie: c1 } },
      env,
    );
    expect(allRes.status).toBe(200);
    const allBody = (await allRes.json()) as {
      laneCounts: { videos: number; shorts: number; live: number; unclassified: number };
      creatorsRail: Array<{ accountId: string; unseenCount: number }>;
      items: Array<{ id: string; isSeen: boolean }>;
    };
    expect(allBody.laneCounts).toEqual({
      videos: 1,
      shorts: 1,
      live: 1,
      unclassified: 1,
    });
    expect(allBody.creatorsRail[0]?.unseenCount).toBe(4);

    // Shorts lane filter + sort by views
    const shortsRes = await app.request(
      'https://radar.example.com/api/v1/feed?lane=shorts&sort=views',
      { headers: { Cookie: c1 } },
      env,
    );
    const shortsBody = (await shortsRes.json()) as { items: Array<{ id: string }> };
    expect(shortsBody.items.map((i) => i.id)).toEqual(['itm-short']);

    // Mark-seen reduces unseenCount and filters unseenOnly
    const markRes = await app.request(
      'https://radar.example.com/api/v1/feed/mark-seen',
      {
        method: 'POST',
        headers: {
          Cookie: c1,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemIds: ['itm-short', 'itm-vid'] }),
      },
      env,
    );
    expect(markRes.status).toBe(200);

    const unseenRes = await app.request(
      'https://radar.example.com/api/v1/feed?unseenOnly=true',
      { headers: { Cookie: c1 } },
      env,
    );
    const unseenBody = (await unseenRes.json()) as {
      creatorsRail: Array<{ unseenCount: number }>;
      items: Array<{ id: string }>;
    };
    expect(unseenBody.creatorsRail[0]?.unseenCount).toBe(2);
    expect(unseenBody.items.map((i) => i.id)).not.toContain('itm-short');

    // Item detail (ws-1 sees it; ws-2 gets 404 IDOR check)
    const detailOk = await app.request(
      'https://radar.example.com/api/v1/feed/itm-vid/detail',
      { headers: { Cookie: c1 } },
      env,
    );
    expect(detailOk.status).toBe(200);
    expect(((await detailOk.json()) as { alerts: unknown[] }).alerts).toHaveLength(1);

    const detailIdor = await app.request(
      'https://radar.example.com/api/v1/feed/itm-vid/detail',
      { headers: { Cookie: cOther } },
      env,
    );
    expect(detailIdor.status).toBe(404);

    // Saved views CRUD + IDOR isolation
    const saveRes = await app.request(
      'https://radar.example.com/api/v1/saved-views',
      {
        method: 'POST',
        headers: {
          Cookie: c1,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'High-view Shorts',
          filters: { lane: 'shorts', minViews: 50000 },
        }),
      },
      env,
    );
    expect(saveRes.status).toBe(201);
    const viewId = ((await saveRes.json()) as { view: { id: string } }).view.id;

    const listViews = await app.request(
      'https://radar.example.com/api/v1/saved-views',
      { headers: { Cookie: c1 } },
      env,
    );
    expect(((await listViews.json()) as { views: unknown[] }).views).toHaveLength(1);

    const otherDel = await app.request(
      `https://radar.example.com/api/v1/saved-views/${viewId}`,
      {
        method: 'DELETE',
        headers: { Cookie: cOther, Origin: 'https://radar.example.com' },
      },
      env,
    );
    expect(otherDel.status).toBe(404);
  });

  it('serves real Mission Control KPIs and Kanban Work Board transitions, WS broadcasts, and overlap conflict details', async () => {
    const app = createApp();
    const env = makeEnv();
    const c1 = await loginAs(app, env, 'editor1@example.com', '111111');
    const c2 = await loginAs(app, env, 'editor2@example.com', '222222');

    // Mission Control reflects real seeded counts
    const mcRes = await app.request(
      'https://radar.example.com/api/v1/mission-control',
      { headers: { Cookie: c1 } },
      env,
    );
    expect(mcRes.status).toBe(200);
    const mc = (await mcRes.json()) as {
      hasSources: boolean;
      hasItems: boolean;
      kpis: { liveNowCount: number; hotUnclaimedCount: number; newItems24h: { total: number } };
      needsAttention: Array<{ alertId: string | null }>;
    };
    expect(mc.hasSources).toBe(true);
    expect(mc.hasItems).toBe(true);
    expect(mc.kpis.liveNowCount).toBe(1);
    expect(mc.kpis.hotUnclaimedCount).toBe(1);
    expect(mc.kpis.newItems24h.total).toBe(4);
    expect(mc.needsAttention[0]?.alertId).toBe('al-1');

    // Claim range [60, 120) by editor1
    const claim1 = await app.request(
      'https://radar.example.com/api/v1/claims',
      {
        method: 'POST',
        headers: {
          Cookie: c1,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemId: 'itm-vid', startSec: 60, endSec: 120 }),
      },
      env,
    );
    expect(claim1.status).toBe(201);
    const claimId = ((await claim1.json()) as { claim: { id: string } }).claim.id;

    // Overlapping range [90, 150) by editor2 returns 409 with claimerEmail details
    const overlap = await app.request(
      'https://radar.example.com/api/v1/claims',
      {
        method: 'POST',
        headers: {
          Cookie: c2,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemId: 'itm-vid', startSec: 90, endSec: 150 }),
      },
      env,
    );
    expect(overlap.status).toBe(409);
    expect(await overlap.json()).toMatchObject({
      error: {
        code: 'CONFLICT',
        details: {
          claimerEmail: 'editor1@example.com',
          startSec: 60,
          endSec: 120,
        },
      },
    });

    // Transition Claimed -> Clipping -> Published with clipUrl + WS broadcast
    const toClipping = await app.request(
      `https://radar.example.com/api/v1/claims/${claimId}`,
      {
        method: 'PATCH',
        headers: {
          Cookie: c1,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'Clipping' }),
      },
      env,
    );
    expect(toClipping.status).toBe(200);

    const toPublished = await app.request(
      `https://radar.example.com/api/v1/claims/${claimId}`,
      {
        method: 'PATCH',
        headers: {
          Cookie: c1,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'Published',
          clipUrl: 'https://youtube.com/shorts/published1',
        }),
      },
      env,
    );
    expect(toPublished.status).toBe(200);
    expect(wsEvents.map((e) => e.eventType)).toEqual([
      'claim.created',
      'claim.updated',
      'claim.updated',
    ]);

    // Enriched Work Board returns real title, thumbnail, creatorName, claimerEmail, clipUrl
    const boardRes = await app.request(
      'https://radar.example.com/api/v1/claims',
      { headers: { Cookie: c1 } },
      env,
    );
    expect(boardRes.status).toBe(200);
    const board = (await boardRes.json()) as {
      claims: Array<{
        title: string;
        creatorName: string;
        claimerEmail: string;
        status: string;
        clipUrl: string | null;
      }>;
    };
    expect(board.claims[0]).toMatchObject({
      title: 'Full Documentary',
      creatorName: 'Creator One',
      claimerEmail: 'editor1@example.com',
      status: 'Published',
      clipUrl: 'https://youtube.com/shorts/published1',
    });
  });
});
