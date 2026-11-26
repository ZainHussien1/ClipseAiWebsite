import { Hono } from 'hono';
import {
  AppError,
  bulkCreateSourcesSchema,
  createSourceSchema,
  parseSourceInput,
  sourceRuleSchema,
  updateSourceSchema,
  type CreateSourceInput,
  type SourceItem,
  type SourceRule,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';

interface FollowRow {
  follow_id: string;
  account_id: string;
  platform: 'youtube' | 'twitch' | 'kick';
  external_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  starred: number;
  is_own: number;
  paused: number;
  archived: number;
  group_name: string | null;
  tags_json: string;
  rules_json: string;
  last_synced_at: string | null;
  created_at: string;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parseRules(raw: string): SourceRule {
  try {
    return sourceRuleSchema.parse(JSON.parse(raw));
  } catch {
    return sourceRuleSchema.parse({});
  }
}

function mapFollowRow(row: FollowRow): SourceItem {
  return {
    followId: row.follow_id,
    accountId: row.account_id,
    platform: row.platform,
    externalId: row.external_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    starred: row.starred === 1,
    isOwn: row.is_own === 1,
    paused: row.paused === 1,
    archived: row.archived === 1,
    groupName: row.group_name,
    tags: parseJsonArray(row.tags_json),
    rules: parseRules(row.rules_json),
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
  };
}

async function upsertSourceForWorkspace(
  db: D1Database,
  workspaceId: string,
  entry: CreateSourceInput,
): Promise<SourceItem> {
  const parsed = parseSourceInput(entry.input);
  if (!parsed.ok) {
    throw AppError.badRequest(parsed.message, { code: parsed.code, input: entry.input });
  }

  const { platform, externalId } = parsed.value;
  const now = new Date().toISOString();
  const newAccountId = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO platform_accounts (id, platform, external_id, handle, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (platform, external_id) DO NOTHING`,
    )
    .bind(newAccountId, platform, externalId, externalId, externalId, now, now)
    .run();

  const account = await db
    .prepare('SELECT id FROM platform_accounts WHERE platform = ? AND external_id = ?')
    .bind(platform, externalId)
    .first<{ id: string }>();

  if (!account) {
    throw AppError.internal('Failed to resolve platform account');
  }

  const followId = crypto.randomUUID();
  const rules = sourceRuleSchema.parse(entry.rules ?? {});
  const tagsJson = JSON.stringify(entry.tags ?? []);

  await db
    .prepare(
      `INSERT INTO follows (id, workspace_id, account_id, starred, is_own, paused, archived, group_name, tags_json, rules_json, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, account_id) DO UPDATE SET
         starred = excluded.starred,
         is_own = excluded.is_own,
         archived = 0,
         group_name = COALESCE(excluded.group_name, follows.group_name),
         tags_json = excluded.tags_json,
         rules_json = excluded.rules_json`,
    )
    .bind(
      followId,
      workspaceId,
      account.id,
      entry.starred ? 1 : 0,
      entry.isOwn ? 1 : 0,
      entry.groupName ?? null,
      tagsJson,
      JSON.stringify(rules),
      now,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT f.id AS follow_id, a.id AS account_id, a.platform, a.external_id, a.handle, a.display_name,
              a.avatar_url, f.starred, f.is_own, f.paused, f.archived, f.group_name, f.tags_json,
              f.rules_json, a.last_synced_at, f.created_at
       FROM follows f
       JOIN platform_accounts a ON a.id = f.account_id
       WHERE f.workspace_id = ? AND f.account_id = ?`,
    )
    .bind(workspaceId, account.id)
    .first<FollowRow>();

  if (!row) {
    throw AppError.internal('Failed to load created source');
  }
  return mapFollowRow(row);
}

export function createSourcesRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');
    const includeArchived = c.req.query('archived') === 'true';

    const result = await c.env.DB.prepare(
      `SELECT f.id AS follow_id, a.id AS account_id, a.platform, a.external_id, a.handle, a.display_name,
              a.avatar_url, f.starred, f.is_own, f.paused, f.archived, f.group_name, f.tags_json,
              f.rules_json, a.last_synced_at, f.created_at
       FROM follows f
       JOIN platform_accounts a ON a.id = f.account_id
       WHERE f.workspace_id = ? AND (? = 1 OR f.archived = 0)
       ORDER BY f.starred DESC, f.created_at DESC, f.id DESC`,
    )
      .bind(principal.workspaceId, includeArchived ? 1 : 0)
      .all<FollowRow>();

    return c.json({
      sources: (result.results ?? []).map(mapFollowRow),
      source: 'd1',
      asOf: new Date().toISOString(),
    });
  });

  router.post('/', async (c) => {
    const principal = c.get('principal');
    const body = createSourceSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid source payload', body.error.flatten());
    }
    const item = await upsertSourceForWorkspace(c.env.DB, principal.workspaceId, body.data);
    return c.json({ source: item }, 201);
  });

  router.post('/bulk', async (c) => {
    const principal = c.get('principal');
    const body = bulkCreateSourcesSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid bulk source payload', body.error.flatten());
    }

    const entries: CreateSourceInput[] = body.data.entries
      ? [...body.data.entries]
      : (body.data.rawLines ?? '')
          .split(/\r?\n|,/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 200)
          .map((input) => ({
            input,
            starred: body.data.starred ?? false,
            isOwn: false,
            groupName: body.data.groupName,
            tags: body.data.tags ?? [],
          }));

    const added: SourceItem[] = [];
    const rejected: Array<{ input: string; code: string; message: string }> = [];

    for (const entry of entries) {
      try {
        added.push(await upsertSourceForWorkspace(c.env.DB, principal.workspaceId, entry));
      } catch (err) {
        if (err instanceof AppError && err.code === 'BAD_REQUEST') {
          const details = err.details as { code?: string } | undefined;
          rejected.push({
            input: entry.input,
            code: details?.code ?? 'INVALID_INPUT',
            message: err.message,
          });
        } else {
          throw err;
        }
      }
    }

    return c.json({ added, rejected }, 201);
  });

  router.patch('/:followId', async (c) => {
    const principal = c.get('principal');
    const followId = c.req.param('followId');
    const body = updateSourceSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid source update payload', body.error.flatten());
    }

    const existing = await c.env.DB.prepare(
      `SELECT f.id AS follow_id, a.id AS account_id, a.platform, a.external_id, a.handle, a.display_name,
              a.avatar_url, f.starred, f.is_own, f.paused, f.archived, f.group_name, f.tags_json,
              f.rules_json, a.last_synced_at, f.created_at
       FROM follows f
       JOIN platform_accounts a ON a.id = f.account_id
       WHERE f.id = ? AND f.workspace_id = ?`,
    )
      .bind(followId, principal.workspaceId)
      .first<FollowRow>();

    if (!existing) {
      throw AppError.notFound('Source not found');
    }

    const nextStarred = body.data.starred ?? existing.starred === 1;
    const nextPaused = body.data.paused ?? existing.paused === 1;
    const nextArchived = body.data.archived ?? existing.archived === 1;
    const nextGroup =
      body.data.groupName === undefined ? existing.group_name : body.data.groupName;
    const nextTags = body.data.tags ?? parseJsonArray(existing.tags_json);
    const nextRules = body.data.rules
      ? sourceRuleSchema.parse({ ...parseRules(existing.rules_json), ...body.data.rules })
      : parseRules(existing.rules_json);

    await c.env.DB.prepare(
      `UPDATE follows
       SET starred = ?, paused = ?, archived = ?, group_name = ?, tags_json = ?, rules_json = ?
       WHERE id = ? AND workspace_id = ?`,
    )
      .bind(
        nextStarred ? 1 : 0,
        nextPaused ? 1 : 0,
        nextArchived ? 1 : 0,
        nextGroup,
        JSON.stringify(nextTags),
        JSON.stringify(nextRules),
        followId,
        principal.workspaceId,
      )
      .run();

    return c.json({
      source: {
        ...mapFollowRow(existing),
        starred: nextStarred,
        paused: nextPaused,
        archived: nextArchived,
        groupName: nextGroup,
        tags: nextTags,
        rules: nextRules,
      },
    });
  });

  router.delete('/:followId', async (c) => {
    const principal = c.get('principal');
    const followId = c.req.param('followId');

    const res = await c.env.DB.prepare(
      'DELETE FROM follows WHERE id = ? AND workspace_id = ?',
    )
      .bind(followId, principal.workspaceId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      throw AppError.notFound('Source not found');
    }

    return c.json({ deleted: true, followId });
  });

  return router;
}
