import { Hono } from 'hono';
import {
  AppError,
  exportFormatSchema,
  hasRoleAtLeast,
  inviteMemberSchema,
  MAX_TEAM_SEATS,
  memberAvailabilitySchema,
  memberUpdateSchema,
  type MemberAvailability,
  type Role,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { requireWriterRole } from '../auth.js';
import { hashPassphrase } from '../session.js';

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

  router.post('/settings/members/invite', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('Only Admins or Owners can invite members');
    }

    const body = inviteMemberSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid invite member payload', body.error.flatten());
    }

    if (body.data.role === 'Owner' && principal.role !== 'Owner') {
      throw AppError.forbidden('Only an Owner can invite another Owner');
    }

    const email = body.data.email.toLowerCase();
    const now = new Date().toISOString();
    const passphraseHash = await hashPassphrase(body.data.temporaryPassphrase);

    const existing = await c.env.DB.prepare(
      'SELECT user_id FROM memberships WHERE workspace_id = ? AND LOWER(email) = ? LIMIT 1',
    )
      .bind(principal.workspaceId, email)
      .first<{ user_id: string }>();

    if (existing) {
      await c.env.DB.prepare(
        'UPDATE memberships SET role = ?, passphrase_hash = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?',
      )
        .bind(body.data.role, passphraseHash, now, principal.workspaceId, existing.user_id)
        .run();
    } else {
      const seatRow = await c.env.DB.prepare(
        'SELECT COUNT(*) AS cnt FROM memberships WHERE workspace_id = ?',
      )
        .bind(principal.workspaceId)
        .first<{ cnt: number }>();

      if ((seatRow?.cnt ?? 0) >= MAX_TEAM_SEATS) {
        throw AppError.badRequest(
          `Team seat limit reached (maximum ${MAX_TEAM_SEATS} members)`,
        );
      }

      const userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
      const membershipId = `mem-${crypto.randomUUID().slice(0, 8)}`;
      await c.env.DB.prepare(
        `INSERT INTO memberships (id, workspace_id, user_id, email, role, passphrase_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          membershipId,
          principal.workspaceId,
          userId,
          email,
          body.data.role,
          passphraseHash,
          now,
          now,
        )
        .run();
    }

    const totalSeatsRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM memberships WHERE workspace_id = ?',
    )
      .bind(principal.workspaceId)
      .first<{ cnt: number }>();

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'member.invited', 'membership', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        principal.workspaceId,
        principal.userId,
        email,
        JSON.stringify({ role: body.data.role }),
        now,
      )
      .run();

    return c.json(
      {
        ok: true,
        message: 'Member allowlist updated.',
        maxSeats: MAX_TEAM_SEATS,
        seatsUsed: totalSeatsRow?.cnt ?? 0,
      },
      existing ? 200 : 201,
    );
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

    const targetMember = await c.env.DB.prepare(
      'SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?',
    )
      .bind(principal.workspaceId, targetUserId)
      .first<{ role: Role }>();

    if (!targetMember) {
      throw AppError.notFound('Member not found');
    }

    if (targetMember.role === 'Owner' && body.data.role !== 'Owner') {
      const ownersRow = await c.env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM memberships WHERE workspace_id = ? AND role = 'Owner'",
      )
        .bind(principal.workspaceId)
        .first<{ cnt: number }>();
      if ((ownersRow?.cnt ?? 0) <= 1) {
        throw AppError.badRequest('Cannot demote the sole Owner of the workspace');
      }
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE memberships SET role = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?',
    )
      .bind(body.data.role, now, principal.workspaceId, targetUserId)
      .run();

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

    const targetMember = await c.env.DB.prepare(
      'SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?',
    )
      .bind(principal.workspaceId, targetUserId)
      .first<{ role: Role }>();

    if (!targetMember) {
      throw AppError.notFound('Member not found');
    }

    if (targetMember.role === 'Owner') {
      const ownersRow = await c.env.DB.prepare(
        "SELECT COUNT(*) AS cnt FROM memberships WHERE workspace_id = ? AND role = 'Owner'",
      )
        .bind(principal.workspaceId)
        .first<{ cnt: number }>();
      if ((ownersRow?.cnt ?? 0) <= 1) {
        throw AppError.badRequest('Cannot remove the sole Owner of the workspace');
      }
    }

    await c.env.DB.prepare(
      'DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?',
    )
      .bind(principal.workspaceId, targetUserId)
      .run();

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

  router.get('/settings/availability', async (c) => {
    const principal = c.get('principal');
    const row = await c.env.DB.prepare(
      'SELECT timezone, availability_json FROM memberships WHERE workspace_id = ? AND user_id = ?',
    )
      .bind(principal.workspaceId, principal.userId)
      .first<{ timezone: string; availability_json: string }>();

    let availability: MemberAvailability = { timezone: row?.timezone ?? 'UTC', schedule: [] };
    if (row?.availability_json) {
      try {
        const parsed = memberAvailabilitySchema.safeParse({
          timezone: row.timezone,
          schedule: JSON.parse(row.availability_json),
        });
        if (parsed.success) {
          availability = parsed.data;
        }
      } catch {
        // default empty schedule
      }
    }

    return c.json({
      availability,
      source: 'Workspace Membership',
      asOf: new Date().toISOString(),
    });
  });

  router.put('/settings/availability', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const body = memberAvailabilitySchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      throw AppError.badRequest('Invalid availability schedule', body.error.flatten());
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE memberships
       SET timezone = ?, availability_json = ?, updated_at = ?
       WHERE workspace_id = ? AND user_id = ?`,
    )
      .bind(
        body.data.timezone,
        JSON.stringify(body.data.schedule),
        now,
        principal.workspaceId,
        principal.userId,
      )
      .run();

    return c.json({ ok: true, availability: body.data });
  });

  router.post('/export', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
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
      c.env.DB.prepare('DELETE FROM creator_notes WHERE workspace_id = ?').bind(wsId),
      c.env.DB.prepare('DELETE FROM dlq_messages WHERE workspace_id = ?').bind(wsId),
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
