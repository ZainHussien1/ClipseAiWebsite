import { Hono } from 'hono';
import {
  AppError,
  confirmClipLinkSchema,
  createClipSchema,
  type ClipPlatform,
  type ClipRecord,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';

interface ClipRow {
  id: string;
  workspace_id: string;
  claim_id: string | null;
  source_item_id: string | null;
  user_id: string | null;
  url: string;
  platform: ClipPlatform;
  title: string | null;
  needs_confirmation: number;
  created_at: string;
  stats_source: 'api' | 'manual' | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  stats_captured_at: string | null;
}

interface OwnUploadRow {
  item_id: string;
  platform: ClipPlatform;
  title: string;
  url: string;
  published_at: string;
  account_handle: string;
}

function mapClipRow(r: ClipRow): ClipRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    claimId: r.claim_id,
    sourceItemId: r.source_item_id,
    userId: r.user_id,
    url: r.url,
    platform: r.platform,
    title: r.title,
    needsConfirmation: r.needs_confirmation === 1,
    statsSource: r.stats_source,
    views: r.views,
    likes: r.likes,
    comments: r.comments,
    statsCapturedAt: r.stats_captured_at,
    createdAt: r.created_at,
  };
}

export function createClipsRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');

    const [clipsRes, ownRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT c.id, c.workspace_id, c.claim_id, c.source_item_id, c.user_id, c.url, c.platform,
                c.title, c.needs_confirmation, c.created_at,
                cs.source AS stats_source, cs.views, cs.likes, cs.comments, cs.captured_at AS stats_captured_at
         FROM clips c
         LEFT JOIN clip_stats_snapshots cs ON cs.id = (
           SELECT cs2.id FROM clip_stats_snapshots cs2
           WHERE cs2.workspace_id = c.workspace_id AND cs2.clip_id = c.id
           ORDER BY cs2.captured_at DESC LIMIT 1
         )
         WHERE c.workspace_id = ?
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT 100`,
      )
        .bind(principal.workspaceId)
        .all<ClipRow>(),
      c.env.DB.prepare(
        `SELECT i.id AS item_id, i.platform, i.title, i.url, i.published_at, a.handle AS account_handle
         FROM items i
         JOIN platform_accounts a ON a.id = i.account_id
         JOIN follows f ON f.account_id = a.id
         WHERE f.workspace_id = ? AND f.is_own = 1 AND f.archived = 0
           AND NOT EXISTS (
             SELECT 1 FROM clips c WHERE c.workspace_id = ? AND c.url = i.url
           )
         ORDER BY i.published_at DESC
         LIMIT 20`,
      )
        .bind(principal.workspaceId, principal.workspaceId)
        .all<OwnUploadRow>(),
    ]);

    return c.json({
      clips: (clipsRes.results ?? []).map(mapClipRow),
      ownUploads: (ownRes.results ?? []).map((r) => ({
        itemId: r.item_id,
        platform: r.platform,
        title: r.title,
        url: r.url,
        publishedAt: r.published_at,
        accountHandle: r.account_handle,
      })),
      source: 'd1',
      asOf: new Date().toISOString(),
    });
  });

  router.post('/', async (c) => {
    const principal = c.get('principal');
    const body = createClipSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid clip payload', body.error.flatten());
    }

    let resolvedSourceItemId: string | null = body.data.sourceItemId ?? null;
    if (!resolvedSourceItemId && body.data.claimId) {
      const claimRow = await c.env.DB.prepare(
        'SELECT item_id FROM claims WHERE id = ? AND workspace_id = ?',
      )
        .bind(body.data.claimId, principal.workspaceId)
        .first<{ item_id: string }>();
      if (claimRow) {
        resolvedSourceItemId = claimRow.item_id;
      }
    }

    if (!resolvedSourceItemId && body.data.description) {
      const followedItems = await c.env.DB.prepare(
        `SELECT i.id, i.url
         FROM items i
         JOIN follows f ON f.account_id = i.account_id
         WHERE f.workspace_id = ?
         ORDER BY i.published_at DESC
         LIMIT 200`,
      )
        .bind(principal.workspaceId)
        .all<{ id: string; url: string }>();

      const match = (followedItems.results ?? []).find((it) =>
        body.data.description?.includes(it.url),
      );
      if (match) {
        resolvedSourceItemId = match.id;
      }
    }

    const needsConfirmation = resolvedSourceItemId === null ? 1 : 0;
    const isManualStats = body.data.manualStats ? 1 : 0;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO clips
         (id, workspace_id, claim_id, source_item_id, user_id, url, platform, title, description,
          manual_stats_json, is_manual_stats, needs_confirmation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        principal.workspaceId,
        body.data.claimId ?? null,
        resolvedSourceItemId,
        principal.userId,
        body.data.url,
        body.data.platform,
        body.data.title ?? null,
        body.data.description ?? null,
        body.data.manualStats ? JSON.stringify(body.data.manualStats) : null,
        isManualStats,
        needsConfirmation,
        now,
        now,
      )
      .run();

    if (body.data.manualStats) {
      await c.env.DB.prepare(
        `INSERT INTO clip_stats_snapshots (id, workspace_id, clip_id, views, likes, comments, source, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`,
      )
        .bind(
          crypto.randomUUID(),
          principal.workspaceId,
          id,
          body.data.manualStats.views,
          body.data.manualStats.likes ?? null,
          body.data.manualStats.comments ?? null,
          now,
        )
        .run();
    }

    const clip: ClipRecord = {
      id,
      workspaceId: principal.workspaceId,
      claimId: body.data.claimId ?? null,
      sourceItemId: resolvedSourceItemId,
      userId: principal.userId,
      url: body.data.url,
      platform: body.data.platform,
      title: body.data.title ?? null,
      needsConfirmation: needsConfirmation === 1,
      statsSource: body.data.manualStats ? 'manual' : null,
      views: body.data.manualStats?.views ?? null,
      likes: body.data.manualStats?.likes ?? null,
      comments: body.data.manualStats?.comments ?? null,
      statsCapturedAt: body.data.manualStats ? now : null,
      createdAt: now,
    };

    return c.json({ clip }, 201);
  });

  router.post('/:id/confirm-link', async (c) => {
    const principal = c.get('principal');
    const clipId = c.req.param('id');
    const body = confirmClipLinkSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid link confirmation payload', body.error.flatten());
    }

    const now = new Date().toISOString();
    const res = await c.env.DB.prepare(
      `UPDATE clips
       SET source_item_id = ?, needs_confirmation = 0, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
      .bind(body.data.sourceItemId, now, clipId, principal.workspaceId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      throw AppError.notFound('Clip not found');
    }

    return c.json({
      ok: true,
      clipId,
      sourceItemId: body.data.sourceItemId,
      needsConfirmation: false,
    });
  });

  return router;
}
