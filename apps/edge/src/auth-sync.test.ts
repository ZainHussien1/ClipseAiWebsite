import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// @ts-expect-error node:sqlite is built-in in Node 22+
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('Session auth bootstrap, providers status, health 200, and source sync', () => {
  let sqlite: DatabaseSync;
  const sessionSecret = 'test-session-secret-key-32-chars-ok';

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

  it('reports health status ok with authMode session when SESSION_SECRET is set', async () => {
    const app = createApp();
    const res = await app.request('https://radar.example.com/api/v1/health', {}, makeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'ok',
      authMode: 'session',
      authConfigured: true,
    });
  });

  it('bootstraps first workspace, issues session cookie, rejects non-member, and logs out', async () => {
    const app = createApp();
    const env = makeEnv();

    // Status before bootstrap
    const st1 = await app.request('https://radar.example.com/api/v1/auth/status', {}, env);
    expect(st1.status).toBe(200);
    expect(await st1.json()).toEqual({
      mode: 'session',
      authenticated: false,
      email: null,
      hasWorkspace: false,
    });

    // Bootstrap first workspace -> 201 + Set-Cookie
    const bootRes = await app.request(
      'https://radar.example.com/api/v1/auth/bootstrap',
      {
        method: 'POST',
        headers: {
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'owner@example.com',
          workspaceName: 'Main Studio',
        }),
      },
      env,
    );
    expect(bootRes.status).toBe(201);
    const setCookie = bootRes.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('__Host-clipse_session=');
    const cookiePair = setCookie.split(';')[0] ?? '';

    // Authenticated /api/v1/me works with session cookie
    const meRes = await app.request(
      'https://radar.example.com/api/v1/me',
      { headers: { Cookie: cookiePair } },
      env,
    );
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toMatchObject({
      email: 'owner@example.com',
      role: 'Owner',
    });

    // Unknown email rejected with 403 once workspace exists
    const outsiderRes = await app.request(
      'https://radar.example.com/api/v1/auth/bootstrap',
      {
        method: 'POST',
        headers: {
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'stranger@example.com' }),
      },
      env,
    );
    expect(outsiderRes.status).toBe(403);

    // Existing owner can sign back in -> 200
    const loginRes = await app.request(
      'https://radar.example.com/api/v1/auth/bootstrap',
      {
        method: 'POST',
        headers: {
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'owner@example.com' }),
      },
      env,
    );
    expect(loginRes.status).toBe(200);

    // Logout clears cookie
    const logoutRes = await app.request(
      'https://radar.example.com/api/v1/auth/logout',
      {
        method: 'POST',
        headers: { Origin: 'https://radar.example.com' },
      },
      env,
    );
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('returns honest provider status and triggers engine sync on add & sync endpoints', async () => {
    const app = createApp();
    const syncCalls: Array<{ platform: string; externalId: string }> = [];
    const env = makeEnv({
      ENGINE: {
        async syncAccount(input) {
          syncCalls.push(input);
          return {
            ok: true,
            status: 'synced',
            itemsSynced: 3,
            channelName: 'MKBHD',
            resolvedExternalId: 'UCBJycsmduvYEL83R_U4JriQ',
          };
        },
      },
    });

    const boot = await app.request(
      'https://radar.example.com/api/v1/auth/bootstrap',
      {
        method: 'POST',
        headers: {
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'owner@example.com' }),
      },
      env,
    );
    const cookiePair = (boot.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

    const provRes = await app.request(
      'https://radar.example.com/api/v1/providers/status',
      { headers: { Cookie: cookiePair } },
      env,
    );
    expect(provRes.status).toBe(200);
    expect(await provRes.json()).toMatchObject({
      providers: {
        youtube: { status: 'public_feed_active' },
        twitch: { status: 'credentials_missing' },
        kick: { status: 'credentials_missing' },
      },
    });

    const addRes = await app.request(
      'https://radar.example.com/api/v1/sources',
      {
        method: 'POST',
        headers: {
          Cookie: cookiePair,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: 'https://www.youtube.com/@mkbhd' }),
      },
      env,
    );
    expect(addRes.status).toBe(201);
    const addBody = (await addRes.json()) as {
      source: { followId: string; displayName: string };
      sync: { itemsSynced: number };
    };
    expect(addBody.source.displayName).toBe('MKBHD');
    expect(addBody.sync.itemsSynced).toBe(3);

    const syncOne = await app.request(
      `https://radar.example.com/api/v1/sources/${addBody.source.followId}/sync`,
      {
        method: 'POST',
        headers: {
          Cookie: cookiePair,
          Origin: 'https://radar.example.com',
        },
      },
      env,
    );
    expect(syncOne.status).toBe(200);

    const syncAll = await app.request(
      'https://radar.example.com/api/v1/sources/sync-all',
      {
        method: 'POST',
        headers: {
          Cookie: cookiePair,
          Origin: 'https://radar.example.com',
        },
      },
      env,
    );
    expect(syncAll.status).toBe(200);
    expect(await syncAll.json()).toMatchObject({ ok: true, syncedCount: 1 });
    expect(syncCalls).toHaveLength(3);
  });

  it('re-points follows when @handle resolves to UC... canonical account and serves feed items', async () => {
    const app = createApp();
    const canonicalUc = 'UCX6OQ3DkcsbYNE6H8uQQuVA';
    const env = makeEnv({
      ENGINE: {
        async syncAccount(input) {
          // Simulate Engine ingest creating canonical account acct:youtube:UC... + item
          sqlite.exec(`
            INSERT INTO platform_accounts (id, platform, external_id, handle, display_name)
            VALUES ('acct:youtube:${canonicalUc}', 'youtube', '${canonicalUc}', '${input.externalId}', 'MrBeast')
            ON CONFLICT (platform, external_id) DO NOTHING;
            INSERT INTO items (id, account_id, platform, external_id, kind, title, url, published_at, first_seen_at)
            VALUES ('itm-mrbeast-1', 'acct:youtube:${canonicalUc}', 'youtube', 'vid-1', 'video', 'MrBeast Video', 'https://www.youtube.com/watch?v=vid-1', '2026-11-26T10:00:00.000Z', '2026-11-26T10:00:02.000Z')
            ON CONFLICT (platform, external_id) DO NOTHING;
          `);
          return {
            ok: true,
            status: 'synced',
            itemsSynced: 1,
            channelName: 'MrBeast',
            resolvedExternalId: canonicalUc,
          };
        },
      },
    });

    const boot = await app.request(
      'https://radar.example.com/api/v1/auth/bootstrap',
      {
        method: 'POST',
        headers: {
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'owner@example.com' }),
      },
      env,
    );
    const cookiePair = (boot.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

    const addRes = await app.request(
      'https://radar.example.com/api/v1/sources',
      {
        method: 'POST',
        headers: {
          Cookie: cookiePair,
          Origin: 'https://radar.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: 'https://www.youtube.com/@mrbeast' }),
      },
      env,
    );
    expect(addRes.status).toBe(201);
    const addBody = (await addRes.json()) as {
      source: { accountId: string; externalId: string; displayName: string };
    };
    expect(addBody.source.accountId).toBe(`acct:youtube:${canonicalUc}`);
    expect(addBody.source.externalId).toBe(canonicalUc);
    expect(addBody.source.displayName).toBe('MrBeast');

    // Feed immediately returns the synced item
    const feedRes = await app.request(
      'https://radar.example.com/api/v1/feed',
      { headers: { Cookie: cookiePair } },
      env,
    );
    expect(feedRes.status).toBe(200);
    const feedBody = (await feedRes.json()) as {
      items: Array<{ id: string; title: string }>;
    };
    expect(feedBody.items).toHaveLength(1);
    expect(feedBody.items[0]?.id).toBe('itm-mrbeast-1');

    // Temporary @mrbeast account row was cleaned up
    const tempRow = sqlite
      .prepare('SELECT id FROM platform_accounts WHERE external_id = ?')
      .get('@mrbeast');
    expect(tempRow).toBeUndefined();
  });
});
