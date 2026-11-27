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

describe('V4 Alerts v2, Rising v2, Delivery Log, IANA TZ Prefs, and On-Shift Availability', () => {
  let sqlite: DatabaseSync;
  const sessionSecret = 'v4-alerts-rising-secret-32-chars';

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
    const oldIso = new Date(Date.now() - 10 * 86_400_000).toISOString();
    sqlite.exec(`
      INSERT INTO workspaces (id, slug, name, timezone) VALUES
        ('ws-1', 'ws1', 'Studio 1', 'UTC'),
        ('ws-2', 'ws2', 'Studio 2', 'UTC');
      INSERT INTO memberships (id, workspace_id, user_id, email, role) VALUES
        ('m-1', 'ws-1', 'u-1', 'owner@example.com', 'Owner'),
        ('m-2', 'ws-1', 'u-2', 'viewer@example.com', 'Viewer'),
        ('m-3', 'ws-2', 'u-3', 'other@example.com', 'Owner');
      INSERT INTO platform_accounts (id, platform, external_id, handle, display_name) VALUES
        ('acct:youtube:UC1', 'youtube', 'UC1', '@creator1', 'Creator One');
      INSERT INTO follows (id, workspace_id, account_id, starred) VALUES
        ('flw-1', 'ws-1', 'acct:youtube:UC1', 1);
      INSERT INTO items (id, account_id, platform, external_id, kind, title, url, published_at, is_backfill) VALUES
        ('itm-h1', 'acct:youtube:UC1', 'youtube', 'h1', 'video', 'Hist 1', 'https://youtube.com/watch?v=h1', '${oldIso}', 1),
        ('itm-h2', 'acct:youtube:UC1', 'youtube', 'h2', 'video', 'Hist 2', 'https://youtube.com/watch?v=h2', '${oldIso}', 1),
        ('itm-h3', 'acct:youtube:UC1', 'youtube', 'h3', 'video', 'Hist 3', 'https://youtube.com/watch?v=h3', '${oldIso}', 1),
        ('itm-h4', 'acct:youtube:UC1', 'youtube', 'h4', 'video', 'Hist 4', 'https://youtube.com/watch?v=h4', '${oldIso}', 1),
        ('itm-h5', 'acct:youtube:UC1', 'youtube', 'h5', 'video', 'Hist 5', 'https://youtube.com/watch?v=h5', '${oldIso}', 1),
        ('itm-fresh', 'acct:youtube:UC1', 'youtube', 'vnew', 'video', 'Breakout Video', 'https://youtube.com/watch?v=vnew', '${nowIso}', 0);
      INSERT INTO alerts (id, workspace_id, item_id, type, confidence, score, reason, evidence_json, created_at) VALUES
        ('al-1', 'ws-1', 'itm-fresh', 'breakout', 'high', 3.9, '3.9x median (5 baseline)', '{"velocityRatio":3.9,"engagementRatio":null,"baselineN":5}', '${nowIso}');
      INSERT INTO alert_deliveries (id, workspace_id, alert_id, channel, status, reason, attempted_at) VALUES
        ('del-1', 'ws-1', 'al-1', 'discord', 'suppressed', 'Outside on-shift schedule', '${nowIso}');
    `);
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

  it('exposes full alert lifecycle, acknowledge, delivery log, and test notifications with allowed_mentions:[]', async () => {
    const app = createApp();
    let discordBody: Record<string, unknown> | null = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.body && typeof init.body === 'string') {
        discordBody = JSON.parse(init.body) as Record<string, unknown>;
      }
      return new Response(null, { status: 204 });
    });

    const env = makeEnv({
      DISCORD_WEBHOOK_URL:
        'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz1234',
    });

    try {
      const ownerCookie = await loginAs(app, env, 'owner@example.com', '111111');
      const viewerCookie = await loginAs(app, env, 'viewer@example.com', '222222');
      const otherCookie = await loginAs(app, env, 'other@example.com', '333333');

      // Rising v2 returns paceLabel, baselineN=5, baselineRequired=5
      const risingRes = await app.request(
        'https://radar.example.com/api/v1/rising',
        { headers: { Cookie: ownerCookie } },
        env,
      );
      expect(risingRes.status).toBe(200);
      expect(((await risingRes.json()) as { items: unknown[] }).items[0]).toMatchObject({
        paceLabel: 'Breakout',
        baselineN: 5,
        baselineRequired: 5,
      });

      // Viewer gets 403 on acknowledge & test notification
      const vAck = await app.request(
        'https://radar.example.com/api/v1/alerts/al-1/acknowledge',
        {
          method: 'POST',
          headers: { Cookie: viewerCookie, Origin: 'https://radar.example.com' },
        },
        env,
      );
      expect(vAck.status).toBe(403);

      // Owner acknowledges al-1 & creates task from alert
      const ackRes = await app.request(
        'https://radar.example.com/api/v1/alerts/al-1/acknowledge',
        {
          method: 'POST',
          headers: { Cookie: ownerCookie, Origin: 'https://radar.example.com' },
        },
        env,
      );
      expect(ackRes.status).toBe(200);

      const claimRes = await app.request(
        'https://radar.example.com/api/v1/claims/from-alert/al-1',
        {
          method: 'POST',
          headers: { Cookie: ownerCookie, Origin: 'https://radar.example.com' },
        },
        env,
      );
      expect(claimRes.status).toBe(201);

      // GET /alerts includes deliveries[], acknowledgedAt, and claimedBy
      const alertsRes = await app.request(
        'https://radar.example.com/api/v1/alerts',
        { headers: { Cookie: ownerCookie } },
        env,
      );
      expect(alertsRes.status).toBe(200);
      const alertsBody = (await alertsRes.json()) as {
        alerts: Array<{
          acknowledgedAt: string | null;
          claimedBy: string | null;
          deliveries: Array<{ status: string }>;
        }>;
      };
      expect(alertsBody.alerts[0]?.acknowledgedAt).toBeTruthy();
      expect(alertsBody.alerts[0]?.claimedBy).toBe('owner@example.com');
      expect(alertsBody.alerts[0]?.deliveries[0]?.status).toBe('suppressed');

      // Test notifications: discord (allowed_mentions: { parse: [] }) + in_app
      const testDiscord = await app.request(
        'https://radar.example.com/api/v1/notifications/test',
        {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            Origin: 'https://radar.example.com',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channel: 'discord' }),
        },
        env,
      );
      expect(testDiscord.status).toBe(200);
      expect(await testDiscord.json()).toMatchObject({ ok: true, status: 'delivered' });
      expect(discordBody).toMatchObject({ allowed_mentions: { parse: [] } });

      const testInApp = await app.request(
        'https://radar.example.com/api/v1/notifications/test',
        {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            Origin: 'https://radar.example.com',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channel: 'in_app' }),
        },
        env,
      );
      expect(testInApp.status).toBe(200);

      // Delivery log shows ws-1 rows only (other workspace sees 0)
      const deliv1 = await app.request(
        'https://radar.example.com/api/v1/notifications/deliveries',
        { headers: { Cookie: ownerCookie } },
        env,
      );
      expect(((await deliv1.json()) as { deliveries: unknown[] }).deliveries).toHaveLength(3);

      const delivOther = await app.request(
        'https://radar.example.com/api/v1/notifications/deliveries',
        { headers: { Cookie: otherCookie } },
        env,
      );
      expect(((await delivOther.json()) as { deliveries: unknown[] }).deliveries).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('validates IANA timezones, persists rules & discordDailyDigest, and saves member on-shift availability', async () => {
    const app = createApp();
    const env = makeEnv();
    const ownerCookie = await loginAs(app, env, 'owner@example.com', '111111');

    // Invalid IANA timezone rejected
    const badTz = await app.request(
      'https://radar.example.com/api/v1/notifications/prefs',
      {
        method: 'PUT',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hourlyBudget: 10,
          quietStartHour: null,
          quietEndHour: null,
          timezone: 'Mars/Phobos',
          snoozeUntil: null,
        }),
      },
      env,
    );
    expect(badTz.status).toBe(400);

    // Valid prefs with IANA TZ + rules + discordDailyDigest
    const okPrefs = await app.request(
      'https://radar.example.com/api/v1/notifications/prefs',
      {
        method: 'PUT',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hourlyBudget: 15,
          quietStartHour: 22,
          quietEndHour: 6,
          timezone: 'America/Los_Angeles',
          snoozeUntil: null,
          discordDailyDigest: true,
          rules: {
            breakout: { tier: 'P1', channels: ['discord', 'in_app'] },
          },
        }),
      },
      env,
    );
    expect(okPrefs.status).toBe(200);

    // On-shift availability PUT + GET
    const putAvail = await app.request(
      'https://radar.example.com/api/v1/settings/availability',
      {
        method: 'PUT',
        headers: {
          Cookie: ownerCookie,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timezone: 'Europe/London',
          schedule: [{ day: 1, startHour: 9, endHour: 17, enabled: true }],
        }),
      },
      env,
    );
    expect(putAvail.status).toBe(200);

    const getAvail = await app.request(
      'https://radar.example.com/api/v1/settings/availability',
      { headers: { Cookie: ownerCookie } },
      env,
    );
    expect(getAvail.status).toBe(200);
    expect(await getAvail.json()).toMatchObject({
      availability: {
        timezone: 'Europe/London',
        schedule: [{ day: 1, startHour: 9, endHour: 17, enabled: true }],
      },
    });
  });
});
