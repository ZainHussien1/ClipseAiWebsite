import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// @ts-expect-error node:sqlite is built-in in Node 22+
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('V5 Creators Intelligence, Clip Log Revenue, Reports+Gemini, Invites+Owner Guard, Admin Suite', () => {
  let sqlite: DatabaseSync;
  const sessionSecret = 'v5-creators-admin-secret-32chars';

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
      '0009_v5_creators.sql',
    ]) {
      sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    }

    const nowIso = new Date().toISOString();
    const old10dIso = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const stale48hIso = new Date(Date.now() - 48 * 3_600_000).toISOString();

    sqlite.exec(`
      INSERT INTO workspaces (id, slug, name, timezone) VALUES
        ('ws-1', 'ws1', 'Studio One', 'UTC'),
        ('ws-2', 'ws2', 'Studio Two', 'UTC');
      INSERT INTO memberships (id, workspace_id, user_id, email, role) VALUES
        ('m-1', 'ws-1', 'u-1', 'owner@example.com', 'Owner'),
        ('m-2', 'ws-1', 'u-2', 'viewer@example.com', 'Viewer'),
        ('m-3', 'ws-2', 'u-3', 'other@example.com', 'Owner');
      INSERT INTO platform_accounts (id, platform, external_id, handle, display_name, last_synced_at) VALUES
        ('acct:youtube:UC1', 'youtube', 'UC1', '@creator1', 'Creator One', '${stale48hIso}'),
        ('acct:twitch:TW2', 'twitch', 'TW2', 'creator2', 'Creator Two', '${nowIso}');
      INSERT INTO follows (id, workspace_id, account_id, starred) VALUES
        ('flw-1', 'ws-1', 'acct:youtube:UC1', 1),
        ('flw-2', 'ws-2', 'acct:twitch:TW2', 0);
      INSERT INTO items (id, account_id, platform, external_id, kind, shorts_classification, title, url, published_at, duration_sec) VALUES
        ('itm-1', 'acct:youtube:UC1', 'youtube', 'y1', 'video', 'video', 'Vid 1', 'https://youtube.com/watch?v=y1', '${old10dIso}', 600),
        ('itm-2', 'acct:youtube:UC1', 'youtube', 'y2', 'video', 'video', 'Vid 2', 'https://youtube.com/watch?v=y2', '${old10dIso}', 620),
        ('itm-3', 'acct:youtube:UC1', 'youtube', 'y3', 'video', 'video', 'Vid 3', 'https://youtube.com/watch?v=y3', '${old10dIso}', 640),
        ('itm-4', 'acct:youtube:UC1', 'youtube', 'y4', 'video', 'video', 'Vid 4', 'https://youtube.com/watch?v=y4', '${old10dIso}', 650),
        ('itm-5', 'acct:youtube:UC1', 'youtube', 'y5', 'video', 'video', 'Vid 5', 'https://youtube.com/watch?v=y5', '${old10dIso}', 660),
        ('itm-6', 'acct:youtube:UC1', 'youtube', 'y6', 'short', 'unclassified', 'Mystery Upload', 'https://youtube.com/watch?v=y6', '${nowIso}', NULL),
        ('itm-other', 'acct:twitch:TW2', 'twitch', 't1', 'vod', 'video', 'Other WS VOD', 'https://twitch.tv/videos/1', '${nowIso}', 1800);
      INSERT INTO item_stats (id, item_id, captured_at, views) VALUES
        ('st-1', 'itm-1', '${old10dIso}', 10000),
        ('st-2', 'itm-2', '${old10dIso}', 12000),
        ('st-3', 'itm-3', '${old10dIso}', 15000),
        ('st-4', 'itm-4', '${old10dIso}', 18000),
        ('st-5', 'itm-5', '${old10dIso}', 25000);
      INSERT INTO alerts (id, workspace_id, item_id, type, confidence, score, reason, created_at) VALUES
        ('al-1', 'ws-1', 'itm-6', 'rising', 'high', 3.1, '3.1x baseline', '${nowIso}');
      INSERT INTO claims (id, workspace_id, item_id, user_id, status, created_at) VALUES
        ('clm-1', 'ws-1', 'itm-1', 'u-1', 'Clipped', '${nowIso}'),
        ('clm-orphan', 'ws-1', 'itm-other', 'u-missing', 'Claimed', '${nowIso}');
      INSERT INTO alert_deliveries (id, workspace_id, alert_id, channel, status, reason, attempted_at) VALUES
        ('del-ok', 'ws-1', 'al-1', 'discord', 'delivered', NULL, '${nowIso}'),
        ('del-fail', 'ws-1', 'al-1', 'webpush', 'failed', '410 Gone', '${nowIso}');
      INSERT INTO dlq_messages (id, workspace_id, queue_name, payload_json, error_reason, status, attempts, created_at) VALUES
        ('dlq-1', 'ws-1', 'notify-dlq', '{"alertId":"al-1"}', 'Discord 502', 'pending', 1, '${nowIso}');
      INSERT INTO ingestion_metrics (id, platform, metric_date, pushes_received, missed_pushes, reconcile_runs, updated_at) VALUES
        ('im-today', 'youtube', '${nowIso.slice(0, 10)}', 12, 0, 4, '${nowIso}');
      INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at) VALUES
        ('aud-1', 'ws-1', 'u-1', 'source.added', 'follow', 'flw-1', '{}', '${nowIso}'),
        ('aud-ws2', 'ws-2', 'u-3', 'secret.action', 'workspace', 'ws-2', '{}', '${nowIso}');
    `);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  async function loginCookie(
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
      .run(`otp-${email}-${code}`, email, await hashOtpCode(code), expIso, nowIso);

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
    expect(res.status).toBe(200);
    return (res.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  }

  it('serves Creators Intelligence with baselines, lane counts, heatmap, notes & IDOR guard', async () => {
    const app = createApp();
    const env = makeEnv();
    const ownerCookie = await loginCookie(app, env, 'owner@example.com', '111111');
    const viewerCookie = await loginCookie(app, env, 'viewer@example.com', '222222');

    const listRes = await app.request(
      'https://radar.example.com/api/v1/creators',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      creators: Array<{
        accountId: string;
        cadenceSummary: string;
        baselines: Array<{ kind: string; medianViews: number | null; sampleSize: number; status: string }>;
        laneCounts: { videos: number; unclassified: number };
      }>;
    };
    expect(listBody.creators).toHaveLength(1);
    expect(listBody.creators[0]?.cadenceSummary).toBe('Based on 6 observed events');
    expect(listBody.creators[0]?.laneCounts.videos).toBe(5);
    expect(listBody.creators[0]?.laneCounts.unclassified).toBe(1);
    expect(listBody.creators[0]?.baselines[0]).toMatchObject({
      kind: 'video',
      medianViews: 15000,
      sampleSize: 5,
      status: 'ready',
    });

    const detailRes = await app.request(
      'https://radar.example.com/api/v1/creators/acct:youtube:UC1',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(detailRes.status).toBe(200);
    const detailBody = (await detailRes.json()) as {
      cadence: { ready: boolean; heatmap: unknown[]; avgPerWeek: number | null };
      itemsByLane: { videos: unknown[]; unclassified: unknown[] };
    };
    expect(detailBody.cadence.ready).toBe(true);
    expect(detailBody.cadence.heatmap.length).toBeGreaterThan(0);
    expect(detailBody.itemsByLane.videos).toHaveLength(5);
    expect(detailBody.itemsByLane.unclassified).toHaveLength(1);

    // Cross-workspace creator IDOR blocked with 404
    const idorRes = await app.request(
      'https://radar.example.com/api/v1/creators/acct:twitch:TW2',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(idorRes.status).toBe(404);

    // Viewer cannot update notes (403); Owner can update notes
    const viewerNoteRes = await app.request(
      'https://radar.example.com/api/v1/creators/acct:youtube:UC1/notes',
      {
        method: 'PUT',
        headers: {
          Cookie: viewerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: 'Viewer note' }),
      },
      env,
    );
    expect(viewerNoteRes.status).toBe(403);

    const ownerNoteRes = await app.request(
      'https://radar.example.com/api/v1/creators/acct:youtube:UC1/notes',
      {
        method: 'PUT',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: 'Best clips around 10m mark.' }),
      },
      env,
    );
    expect(ownerNoteRes.status).toBe(200);
    expect((await ownerNoteRes.json()) as { body: string }).toMatchObject({
      ok: true,
      body: 'Best clips around 10m mark.',
    });
  });

  it('logs manual revenue clips with picker items and computes weekly + Gemini grounded daily reports', async () => {
    const app = createApp();
    const env = makeEnv({ GEMINI_API_KEY: 'test-gemini-key' });
    const ownerCookie = await loginCookie(app, env, 'owner@example.com', '333333');

    const createClipRes = await app.request(
      'https://radar.example.com/api/v1/clips',
      {
        method: 'POST',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://youtube.com/shorts/clipv5',
          platform: 'youtube',
          title: 'Big moment clip',
          sourceItemId: 'itm-1',
          manualStats: { views: 50000 },
          manualRevenueCents: 12500,
          publishTime: new Date().toISOString(),
          startSec: 120,
          endSec: 165,
        }),
      },
      env,
    );
    expect(createClipRes.status).toBe(201);
    const clipPayload = (await createClipRes.json()) as {
      clip: {
        manualRevenueCents: number | null;
        revenueSource: string | null;
        sourceItemTitle: string | null;
        sourceCreatorName: string | null;
      };
    };
    expect(clipPayload.clip.manualRevenueCents).toBe(12500);
    expect(clipPayload.clip.revenueSource).toBe('manual');
    expect(clipPayload.clip.sourceItemTitle).toBe('Vid 1');
    expect(clipPayload.clip.sourceCreatorName).toBe('Creator One');

    const clipsListRes = await app.request(
      'https://radar.example.com/api/v1/clips',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(clipsListRes.status).toBe(200);
    const clipsListBody = (await clipsListRes.json()) as {
      sourceItems: Array<{ itemId: string; title: string; creatorName: string }>;
    };
    expect(clipsListBody.sourceItems.some((s) => s.itemId === 'itm-1' && s.creatorName === 'Creator One')).toBe(
      true,
    );

    const weeklyRes = await app.request(
      'https://radar.example.com/api/v1/reports/weekly',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(weeklyRes.status).toBe(200);
    const weeklyBody = (await weeklyRes.json()) as {
      days: unknown[];
      teamSummary: { clipsLoggedCount: number; manualRevenueCents: number; alertsCount: number };
    };
    expect(weeklyBody.days).toHaveLength(7);
    expect(weeklyBody.teamSummary.clipsLoggedCount).toBe(1);
    expect(weeklyBody.teamSummary.manualRevenueCents).toBe(12500);
    expect(weeklyBody.teamSummary.alertsCount).toBe(1);

    // Mock Gemini returning an UNGROUNDED number (999%) -> falls back cleanly to deterministic template
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Velocity jumped 999% with 1 alert today.' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const today = new Date().toISOString().slice(0, 10);
    const dailyFallbackRes = await app.request(
      `https://radar.example.com/api/v1/reports/daily?date=${today}&ai=true`,
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(dailyFallbackRes.status).toBe(200);
    const dailyFallback = (await dailyFallbackRes.json()) as {
      aiInsightsUsed: boolean;
      aiStatus: string;
      narrative: string;
      fallbackReason: string | null;
    };
    expect(dailyFallback.aiInsightsUsed).toBe(false);
    expect(dailyFallback.aiStatus).toBe('fallback_ungrounded');
    expect(dailyFallback.narrative).toContain('1 alerts');
    expect(dailyFallback.fallbackReason).toContain('999');
  });

  it('enforces 3-seat invite allowlist, login with temp passphrase, and sole-Owner delete/demote guard', async () => {
    const app = createApp();
    const env = makeEnv();
    const ownerCookie = await loginCookie(app, env, 'owner@example.com', '444444');

    // Invite 3rd member (seats: u-1, u-2, new member = 3)
    const inviteRes = await app.request(
      'https://radar.example.com/api/v1/settings/members/invite',
      {
        method: 'POST',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'clipper3@example.com',
          role: 'Member',
          temporaryPassphrase: 'temp-clipper-pass-99',
        }),
      },
      env,
    );
    expect(inviteRes.status).toBe(201);
    const inviteText = await inviteRes.text();
    expect(inviteText).not.toContain('pbkdf2');
    expect(inviteText).not.toContain('temp-clipper-pass-99');
    expect(JSON.parse(inviteText)).toMatchObject({
      ok: true,
      maxSeats: 3,
      seatsUsed: 3,
    });

    // 4th member rejected at 3-seat max
    const fourthRes = await app.request(
      'https://radar.example.com/api/v1/settings/members/invite',
      {
        method: 'POST',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'fourth@example.com',
          role: 'Member',
          temporaryPassphrase: 'another-passphrase-1',
        }),
      },
      env,
    );
    expect(fourthRes.status).toBe(400);

    // Invited member can log in with temporary passphrase
    const login3Res = await app.request(
      'https://radar.example.com/api/v1/auth/login',
      {
        method: 'POST',
        headers: {
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'clipper3@example.com',
          passphrase: 'temp-clipper-pass-99',
        }),
      },
      env,
    );
    expect(login3Res.status).toBe(200);

    // Sole-Owner demote guard (400) & sole-Owner remove guard (400)
    const demoteOwnerRes = await app.request(
      'https://radar.example.com/api/v1/settings/members/u-1',
      {
        method: 'PATCH',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'Admin' }),
      },
      env,
    );
    expect(demoteOwnerRes.status).toBe(400);

    const deleteOwnerRes = await app.request(
      'https://radar.example.com/api/v1/settings/members/u-1',
      {
        method: 'DELETE',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
        },
      },
      env,
    );
    expect(deleteOwnerRes.status).toBe(400);
  });

  it('serves Admin Health, DLQ retry, workspace-isolated Audit Log, and Data Quality', async () => {
    const app = createApp();
    const env = makeEnv();
    const ownerCookie = await loginCookie(app, env, 'owner@example.com', '555555');
    const viewerCookie = await loginCookie(app, env, 'viewer@example.com', '666666');

    // Viewer blocked (403)
    const viewerHealth = await app.request(
      'https://radar.example.com/api/v1/admin/health',
      { headers: { Cookie: viewerCookie } },
      env,
    );
    expect(viewerHealth.status).toBe(403);

    const healthRes = await app.request(
      'https://radar.example.com/api/v1/admin/health',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as {
      d1: { dailyWriteLimit: number; writesTodayEstimate: number };
      queues: { notifyDlqCount: number; dlqItems: Array<{ id: string }> };
      cron: { reconcileRunsToday: number };
      delivery: { deliveredCount: number; failedCount: number; successRate: number | null };
    };
    expect(health.d1.dailyWriteLimit).toBe(100000);
    expect(health.d1.writesTodayEstimate).toBeGreaterThan(0);
    expect(health.queues.notifyDlqCount).toBe(1);
    expect(health.cron.reconcileRunsToday).toBe(4);
    expect(health.delivery.successRate).toBe(0.5);

    const retryRes = await app.request(
      'https://radar.example.com/api/v1/admin/dlq/retry',
      {
        method: 'POST',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: 'dlq-1' }),
      },
      env,
    );
    expect(retryRes.status).toBe(200);
    expect(await retryRes.json()).toMatchObject({
      ok: true,
      retriedCount: 1,
      remainingPending: 0,
    });

    // Audit log: filterable + strictly workspace-isolated (aud-ws2 never appears)
    const auditRes = await app.request(
      'https://radar.example.com/api/v1/admin/audit-log?action=dlq.retried',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(auditRes.status).toBe(200);
    const auditBody = (await auditRes.json()) as {
      entries: Array<{ id: string; action: string; actorEmail: string | null }>;
    };
    expect(auditBody.entries).toHaveLength(1);
    expect(auditBody.entries[0]?.action).toBe('dlq.retried');
    expect(auditBody.entries[0]?.actorEmail).toBe('owner@example.com');

    // Data quality
    const dqRes = await app.request(
      'https://radar.example.com/api/v1/admin/data-quality',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(dqRes.status).toBe(200);
    const dqBody = (await dqRes.json()) as {
      counts: {
        missingDuration: number;
        unclassifiedShorts: number;
        staleSources: number;
        orphanClaims: number;
      };
    };
    expect(dqBody.counts).toEqual({
      missingDuration: 1,
      unclassifiedShorts: 1,
      staleSources: 1,
      orphanClaims: 1,
    });
  });
});
