import { Hono } from 'hono';
import {
  AppError,
  createClaimSchema,
  updateClaimSchema,
  type ClaimRecord,
  type ClaimStatus,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { requireWriterRole } from '../auth.js';

interface ClaimRow {
  id: string;
  workspace_id: string;
  item_id: string;
  user_id: string;
  start_sec: number | null;
  end_sec: number | null;
  status: ClaimStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

function mapClaimRow(row: ClaimRow): ClaimRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    itemId: row.item_id,
    userId: row.user_id,
    startSec: row.start_sec,
    endSec: row.end_sec,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

export function createClaimsRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');
    const result = await c.env.DB.prepare(
      `SELECT id, workspace_id, item_id, user_id, start_sec, end_sec, status, note, created_at, updated_at
       FROM claims
       WHERE workspace_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
    )
      .bind(principal.workspaceId)
      .all<ClaimRow>();

    return c.json({
      claims: (result.results ?? []).map(mapClaimRow),
      source: 'd1',
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

    const { itemId, startSec, endSec, note } = body.data;
    const isWholeItem = startSec === undefined && endSec === undefined;
    const normalizedStart = isWholeItem ? null : (startSec ?? 0);
    const normalizedEnd = isWholeItem ? null : (endSec ?? null);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const insertRes = await c.env.DB.prepare(
      `INSERT INTO claims (id, workspace_id, item_id, user_id, start_sec, end_sec, status, note, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, 'Claimed', ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM claims
         WHERE workspace_id = ?
           AND item_id = ?
           AND status IN ('New', 'Claimed', 'Clipped')
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
        principal.workspaceId,
        itemId,
        principal.userId,
        normalizedStart,
        normalizedEnd,
        note ?? null,
        now,
        now,
        principal.workspaceId,
        itemId,
        normalizedStart,
        normalizedEnd,
        normalizedEnd,
        normalizedStart,
      )
      .run();

    if ((insertRes.meta?.changes ?? 0) === 0) {
      throw AppError.conflict('Item or time range is already claimed');
    }

    const claim: ClaimRecord = {
      id,
      workspaceId: principal.workspaceId,
      itemId,
      userId: principal.userId,
      startSec: normalizedStart,
      endSec: normalizedEnd,
      status: 'Claimed',
      note: note ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const eventId = await notifyWorkspaceDo(
      c.env,
      principal.workspaceId,
      'claim.created',
      claim,
    );

    return c.json({ claim, eventId }, 201);
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
      `SELECT id, workspace_id, item_id, user_id, start_sec, end_sec, status, note, created_at, updated_at
       FROM claims
       WHERE id = ? AND workspace_id = ?`,
    )
      .bind(claimId, principal.workspaceId)
      .first<ClaimRow>();

    if (!existing) {
      throw AppError.notFound('Claim not found');
    }

    const now = new Date().toISOString();
    const nextNote = body.data.note === undefined ? existing.note : body.data.note;

    await c.env.DB.prepare(
      `UPDATE claims SET status = ?, note = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    )
      .bind(body.data.status, nextNote, now, claimId, principal.workspaceId)
      .run();

    const updated: ClaimRecord = {
      ...mapClaimRow(existing),
      status: body.data.status,
      note: nextNote,
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
