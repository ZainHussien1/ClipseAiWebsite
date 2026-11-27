import { Hono } from 'hono';
import {
  AppError,
  createClaimSchema,
  formatProviderSource,
  normalizeHandle,
  updateClaimSchema,
  type ClaimRecord,
  type ClaimStatus,
  type HotUnclaimedItem,
  type Platform,
  type WorkBoardClaim,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { requireWriterRole } from '../auth.js';

interface EnrichedClaimRow {
  id: string;
  workspace_id: string;
  item_id: string;
  user_id: string;
  start_sec: number | null;
  end_sec: number | null;
  status: ClaimStatus;
  note: string | null;
  clip_url: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  thumbnail_url: string | null;
  creator_name: string;
  creator_handle: string;
  platform: Platform;
  url: string;
  claimer_email: string | null;
}

interface HotUnclaimedRow {
  alert_id: string;
  item_id: string;
  title: string;
  thumbnail_url: string | null;
  creator_name: string;
  creator_handle: string;
  platform: Platform;
  url: string;
  type: 'rising' | 'breakout' | 'viral' | 'live_moment' | 'vod_ready';
  score: number;
  reason: string;
  created_at: string;
}

const ACTIVE_CLAIM_STATUSES = "('New', 'Claimed', 'Clipping', 'Clipped', 'Published')";

function mapEnrichedClaim(row: EnrichedClaimRow): WorkBoardClaim {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    itemId: row.item_id,
    userId: row.user_id,
    startSec: row.start_sec,
    endSec: row.end_sec,
    status: row.status,
    note: row.note,
    clipUrl: row.clip_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    creatorName: row.creator_name,
    creatorHandle: normalizeHandle(row.creator_handle),
    platform: row.platform,
    url: row.url,
    claimerEmail: row.claimer_email,
  };
}

async function notifyWorkspaceDo(
  env: EdgeBindings,
  workspaceId: string,
  eventType: string,
  payload: unknown,
): Promise<number | null> {
  if (!env.WORKSPACE_DO || typeof env.WORKSPACE_DO.idFromName !== 'function') {
    return null;
  }
  try {
    const stub = env.WORKSPACE_DO.get(env.WORKSPACE_DO.idFromName(workspaceId)) as unknown as {
      emitEvent: (type: string, payload: unknown) => Promise<{ id: number }>;
    };
    const event = await stub.emitEvent(eventType, payload);
    return event.id;
  } catch {
    return null;
  }
}

async function atomicCreateClaim(
  env: EdgeBindings,
  workspaceId: string,
  userId: string,
  input: {
    itemId: string;
    startSec?: number;
    endSec?: number;
    note?: string;
  },
): Promise<{ claim: ClaimRecord; eventId: number | null }> {
  const isWholeItem = input.startSec === undefined && input.endSec === undefined;
  const normalizedStart = isWholeItem ? null : (input.startSec ?? 0);
  const normalizedEnd = isWholeItem ? null : (input.endSec ?? null);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const insertRes = await env.DB.prepare(
    `INSERT INTO claims (id, workspace_id, item_id, user_id, start_sec, end_sec, status, note, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, 'Claimed', ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM claims
       WHERE workspace_id = ?
         AND item_id = ?
         AND status IN ${ACTIVE_CLAIM_STATUSES}
         AND (
           (start_sec IS NULL AND end_sec IS NULL)
           OR (? IS NULL AND ? IS NULL)
           OR (
             COALESCE(start_sec, 0) < COALESCE(?, 2147483647)
             AND COALESCE(end_sec, 2147483647) > COALESCE(?, 0)
           )
         )
     )`,
  )
    .bind(
      id,
      workspaceId,
      input.itemId,
      userId,
      normalizedStart,
      normalizedEnd,
      input.note ?? null,
      now,
      now,
      workspaceId,
      input.itemId,
      normalizedStart,
      normalizedEnd,
      normalizedEnd,
      normalizedStart,
    )
    .run();

  if ((insertRes.meta?.changes ?? 0) === 0) {
    const conflict = await env.DB.prepare(
      `SELECT cl.start_sec, cl.end_sec, m.email AS claimer_email
       FROM claims cl
       LEFT JOIN memberships m
         ON m.workspace_id = cl.workspace_id AND m.user_id = cl.user_id
       WHERE cl.workspace_id = ?
         AND cl.item_id = ?
         AND cl.status IN ${ACTIVE_CLAIM_STATUSES}
       ORDER BY cl.updated_at DESC
       LIMIT 1`,
    )
      .bind(workspaceId, input.itemId)
      .first<{
        start_sec: number | null;
        end_sec: number | null;
        claimer_email: string | null;
      }>();

    const who = conflict?.claimer_email ?? 'another team member';
    throw AppError.conflict(`Item or time range is already claimed by ${who}`, {
      claimerEmail: conflict?.claimer_email ?? null,
      startSec: conflict?.start_sec ?? null,
      endSec: conflict?.end_sec ?? null,
    });
  }

  const claim: ClaimRecord = {
    id,
    workspaceId,
    itemId: input.itemId,
    userId,
    startSec: normalizedStart,
    endSec: normalizedEnd,
    status: 'Claimed',
    note: input.note ?? null,
    clipUrl: null,
    createdAt: now,
    updatedAt: now,
  };

  const eventId = await notifyWorkspaceDo(env, workspaceId, 'claim.created', claim);
  return { claim, eventId };
}

export function createClaimsRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');
    const [claimsRes, hotRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT cl.id, cl.workspace_id, cl.item_id, cl.user_id, cl.start_sec, cl.end_sec,
                cl.status, cl.note, cl.clip_url, cl.created_at, cl.updated_at,
                i.title, i.thumbnail_url, a.display_name AS creator_name,
                a.handle AS creator_handle, i.platform, i.url, m.email AS claimer_email
         FROM claims cl
         JOIN items i ON i.id = cl.item_id
         JOIN platform_accounts a ON a.id = i.account_id
         LEFT JOIN memberships m
           ON m.workspace_id = cl.workspace_id AND m.user_id = cl.user_id
         WHERE cl.workspace_id = ?
         ORDER BY cl.updated_at DESC, cl.id DESC
         LIMIT 150`,
      )
        .bind(principal.workspaceId)
        .all<EnrichedClaimRow>(),
      c.env.DB.prepare(
        `SELECT al.id AS alert_id, al.item_id, i.title, i.thumbnail_url,
                a.display_name AS creator_name, a.handle AS creator_handle,
                i.platform, i.url, al.type, al.score, al.reason, al.created_at
         FROM alerts al
         JOIN items i ON i.id = al.item_id
         JOIN platform_accounts a ON a.id = i.account_id
         WHERE al.workspace_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM claims cl
             WHERE cl.workspace_id = al.workspace_id AND cl.item_id = al.item_id
               AND cl.status IN ${ACTIVE_CLAIM_STATUSES}
           )
         ORDER BY al.score DESC, al.created_at DESC
         LIMIT 25`,
      )
        .bind(principal.workspaceId)
        .all<HotUnclaimedRow>(),
    ]);

    const claims = (claimsRes.results ?? []).map(mapEnrichedClaim);
    const hotUnclaimed: HotUnclaimedItem[] = (hotRes.results ?? []).map((r) => ({
      alertId: r.alert_id,
      itemId: r.item_id,
      title: r.title,
      thumbnailUrl: r.thumbnail_url,
      creatorName: r.creator_name,
      creatorHandle: normalizeHandle(r.creator_handle),
      platform: r.platform,
      url: r.url,
      tier: r.type,
      score: r.score,
      reason: r.reason,
      createdAt: r.created_at,
    }));

    return c.json({
      claims,
      hotUnclaimed,
      statuses: ['New', 'Claimed', 'Clipping', 'Clipped', 'Published', 'Skipped'],
      source: formatProviderSource('youtube', Boolean(c.env.YOUTUBE_API_KEY)),
      asOf: new Date().toISOString(),
    });
  });

  router.post('/', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const body = createClaimSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid claim payload', body.error.flatten());
    }

    const result = await atomicCreateClaim(
      c.env,
      principal.workspaceId,
      principal.userId,
      body.data,
    );
    return c.json(result, 201);
  });

  router.post('/from-alert/:alertId', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const alertId = c.req.param('alertId');

    const alert = await c.env.DB.prepare(
      'SELECT id, item_id, reason FROM alerts WHERE id = ? AND workspace_id = ?',
    )
      .bind(alertId, principal.workspaceId)
      .first<{ id: string; item_id: string; reason: string }>();

    if (!alert) {
      throw AppError.notFound('Alert not found');
    }

    const result = await atomicCreateClaim(
      c.env,
      principal.workspaceId,
      principal.userId,
      { itemId: alert.item_id, note: alert.reason },
    );
    return c.json(result, 201);
  });

  router.patch('/:claimId', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const claimId = c.req.param('claimId');
    const body = updateClaimSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid claim update payload', body.error.flatten());
    }

    const existing = await c.env.DB.prepare(
      `SELECT id, workspace_id, item_id, user_id, start_sec, end_sec, status, note, clip_url, created_at, updated_at
       FROM claims
       WHERE id = ? AND workspace_id = ?`,
    )
      .bind(claimId, principal.workspaceId)
      .first<{
        id: string;
        workspace_id: string;
        item_id: string;
        user_id: string;
        start_sec: number | null;
        end_sec: number | null;
        status: ClaimStatus;
        note: string | null;
        clip_url: string | null;
        created_at: string;
        updated_at: string;
      }>();

    if (!existing) {
      throw AppError.notFound('Claim not found');
    }

    const now = new Date().toISOString();
    const nextNote = body.data.note === undefined ? existing.note : body.data.note;
    const nextClipUrl =
      body.data.clipUrl === undefined ? existing.clip_url : body.data.clipUrl;

    await c.env.DB.prepare(
      `UPDATE claims SET status = ?, note = ?, clip_url = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    )
      .bind(
        body.data.status,
        nextNote,
        nextClipUrl,
        now,
        claimId,
        principal.workspaceId,
      )
      .run();

    const updated: ClaimRecord = {
      id: existing.id,
      workspaceId: existing.workspace_id,
      itemId: existing.item_id,
      userId: existing.user_id,
      startSec: existing.start_sec,
      endSec: existing.end_sec,
      status: body.data.status,
      note: nextNote,
      clipUrl: nextClipUrl,
      createdAt: existing.created_at,
      updatedAt: now,
    };

    const eventId = await notifyWorkspaceDo(
      c.env,
      principal.workspaceId,
      'claim.updated',
      updated,
    );

    return c.json({ claim: updated, eventId });
  });

  router.delete('/:claimId', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const claimId = c.req.param('claimId');

    const existing = await c.env.DB.prepare(
      'SELECT id, user_id FROM claims WHERE id = ? AND workspace_id = ?',
    )
      .bind(claimId, principal.workspaceId)
      .first<{ id: string; user_id: string }>();

    if (!existing) {
      throw AppError.notFound('Claim not found');
    }

    if (
      existing.user_id !== principal.userId &&
      principal.role !== 'Owner' &&
      principal.role !== 'Admin'
    ) {
      throw AppError.forbidden('You can only unclaim your own claims');
    }

    await c.env.DB.prepare('DELETE FROM claims WHERE id = ? AND workspace_id = ?')
      .bind(claimId, principal.workspaceId)
      .run();

    const eventId = await notifyWorkspaceDo(
      c.env,
      principal.workspaceId,
      'claim.deleted',
      { id: claimId },
    );

    return c.json({ deleted: true, claimId, eventId });
  });

  return router;
}
