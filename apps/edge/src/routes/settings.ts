import { Hono } from 'hono';
import {
  AppError,
  exportFormatSchema,
  hasRoleAtLeast,
  memberUpdateSchema,
  type Role,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';

interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  role: Role;
  created_at: string;
}

function toCsvCell(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(table: string, rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return `# ${table}: 0 rows\n`;
  const headers = Object.keys(rows[0] ?? {});
  const lines = [
    `# ${table}`,
    headers.map(toCsvCell).join(','),
    ...rows.map((r) => headers.map((h) => toCsvCell(r[h])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export function createSettingsRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/settings/members', async (c) => {
    const principal = c.get('principal');
    const res = await c.env.DB.prepare(
      `SELECT id, user_id, email, role, created_at
       FROM memberships
       WHERE workspace_id = ?
       ORDER BY created_at ASC`,
    )
      .bind(principal.workspaceId)
      .all<MemberRow>();

    return c.json({
      members: (res.results ?? []).map((m) => ({
        id: m.id,
        userId: m.user_id,
        email: m.email,
        role: m.role,
        createdAt: m.created_at,
      })),
      source: 'd1',
      asOf: new Date().toISOString(),
    });
  });

  router.patch('/settings/members/:userId', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('Only Admins or Owners can update member roles');
    }

    const targetUserId = c.req.param('userId');
    const body = memberUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid member role payload', body.error.flatten());
    }

    if (body.data.role === 'Owner' && principal.role !== 'Owner') {
      throw AppError.forbidden('Only an Owner can assign the Owner role');
    }

    const now = new Date().toISOString();
    const res = await c.env.DB.prepare(
      'UPDATE memberships SET role = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?',
    )
      .bind(body.data.role, now, principal.workspaceId, targetUserId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      throw AppError.notFound('Member not found');
    }

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'member.role_updated', 'membership', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        principal.workspaceId,
        principal.userId,
        targetUserId,
        JSON.stringify({ role: body.data.role }),
        now,
      )
      .run();

    return c.json({ ok: true, userId: targetUserId, role: body.data.role });
  });

  router.delete('/settings/members/:userId', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('Only Admins or Owners can remove members');
    }

    const targetUserId = c.req.param('userId');
    if (targetUserId === principal.userId) {
      throw AppError.badRequest('Cannot remove yourself from the workspace');
    }

    const res = await c.env.DB.prepare(
      'DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?',
    )
      .bind(principal.workspaceId, targetUserId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      throw AppError.notFound('Member not found');
    }

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'member.removed', 'membership', ?, '{}', ?)`,
    )
      .bind(
        crypto.randomUUID(),
        principal.workspaceId,
        principal.userId,
        targetUserId,
        new Date().toISOString(),
      )
      .run();

    return c.json({ deleted: true, userId: targetUserId });
  });

  router.post('/export', async (c) => {
    const principal = c.get('principal');
    const body = exportFormatSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw AppError.badRequest('Invalid export format', body.error.flatten());
    }

    const wsId = principal.workspaceId;
    const [ws, follows, claims, clips, alerts] = await Promise.all([
      c.env.DB.prepare('SELECT id, slug, name, timezone, created_at FROM workspaces WHERE id = ?')
        .bind(wsId)
        .all<Record<string, unknown>>(),
      c.env.DB.prepare('SELECT id, account_id, starred, is_own, group_name, created_at FROM follows WHERE workspace_id = ?')
        .bind(wsId)
        .all<Record<string, unknown>>(),
      c.env.DB.prepare('SELECT id, item_id, user_id, start_sec, end_sec, status, note, created_at FROM claims WHERE workspace_id = ?')
        .bind(wsId)
        .all<Record<string, unknown>>(),
      c.env.DB.prepare('SELECT id, claim_id, source_item_id, url, platform, title, is_manual_stats, created_at FROM clips WHERE workspace_id = ?')
        .bind(wsId)
        .all<Record<string, unknown>>(),
      c.env.DB.prepare('SELECT id, item_id, type, confidence, score, reason, created_at FROM alerts WHERE workspace_id = ?')
        .bind(wsId)
        .all<Record<string, unknown>>(),
    ]);

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'workspace.exported', 'workspace', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        wsId,
        principal.userId,
        wsId,
        JSON.stringify({ format: body.data.format }),
        now,
      )
      .run();

    const dateTag = now.slice(0, 10);
    if (body.data.format === 'csv') {
      const csv = [
        rowsToCsv('workspaces', ws.results ?? []),
        rowsToCsv('follows', follows.results ?? []),
        rowsToCsv('claims', claims.results ?? []),
        rowsToCsv('clips', clips.results ?? []),
        rowsToCsv('alerts', alerts.results ?? []),
      ].join('\n');

      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="clipse-export-${dateTag}.csv"`,
        },
      });
    }

    const payload = {
      exportedAt: now,
      workspaceId: wsId,
      workspaces: ws.results ?? [],
      follows: follows.results ?? [],
      claims: claims.results ?? [],
      clips: clips.results ?? [],
      alerts: alerts.results ?? [],
    };

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="clipse-export-${dateTag}.json"`,
      },
    });
  });

  router.delete('/settings/workspace', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Owner')) {
      throw AppError.forbidden('Only a workspace Owner can delete the workspace');
    }

    const wsId = principal.workspaceId;
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'workspace.deleted', 'workspace', ?, '{}', ?)`,
    )
      .bind(crypto.randomUUID(), wsId, principal.userId, wsId, now)
      .run();

    const statements = [
      c.env.DB.prepare('DELETE FROM clip_stats_snapshots WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM clips WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM alert_votes WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM notifications WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM alerts WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM claims WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM follows WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM push_subscriptions WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM notification_prefs WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM audit_logs WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM memberships WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(wsId),
    ];

    if (typeof c.env.DB.batch === 'function') {
      await c.env.DB.batch(statements);
    } else {
      for (const stmt of statements) {
        await stmt.run();
      }
    }

    return c.json({ deleted: true, workspaceId: wsId });
  });

  return router;
}
