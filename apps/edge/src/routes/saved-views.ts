import { Hono } from 'hono';
import {
  AppError,
  createSavedViewSchema,
  savedViewFiltersSchema,
  type SavedViewRecord,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { requireWriterRole } from '../auth.js';

interface SavedViewRow {
  id: string;
  name: string;
  filters_json: string;
  created_at: string;
}

function parseFilters(raw: string) {
  try {
    return savedViewFiltersSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function createSavedViewsRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');
    const res = await c.env.DB.prepare(
      `SELECT id, name, filters_json, created_at
       FROM saved_views
       WHERE workspace_id = ? AND user_id = ?
       ORDER BY created_at DESC`,
    )
      .bind(principal.workspaceId, principal.userId)
      .all<SavedViewRow>();

    const views: SavedViewRecord[] = (res.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      filters: parseFilters(r.filters_json),
      createdAt: r.created_at,
    }));

    return c.json({ views, asOf: new Date().toISOString() });
  });

  router.post('/', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const body = createSavedViewSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid saved view payload', body.error.flatten());
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO saved_views (id, workspace_id, user_id, name, filters_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        principal.workspaceId,
        principal.userId,
        body.data.name,
        JSON.stringify(body.data.filters),
        now,
      )
      .run();

    const view: SavedViewRecord = {
      id,
      name: body.data.name,
      filters: body.data.filters,
      createdAt: now,
    };

    return c.json({ view }, 201);
  });

  router.delete('/:id', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const id = c.req.param('id');

    const res = await c.env.DB.prepare(
      'DELETE FROM saved_views WHERE id = ? AND workspace_id = ? AND user_id = ?',
    )
      .bind(id, principal.workspaceId, principal.userId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      throw AppError.notFound('Saved view not found');
    }

    return c.json({ deleted: true, id });
  });

  return router;
}
