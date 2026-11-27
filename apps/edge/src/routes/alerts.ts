import { Hono } from 'hono';
import {
  acknowledgeAlertSchema,
  alertDeliveryStatusSchema,
  alertVoteSchema,
  AppError,
  formatProviderSource,
  normalizeHandle,
  type AlertConfidence,
  type AlertDeliveryRecord,
  type AlertItem,
  type AlertType,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { requireWriterRole } from '../auth.js';

interface AlertRow {
  id: string;
  item_id: string;
  account_handle: string;
  account_display_name: string;
  platform: 'youtube' | 'twitch' | 'kick';
  title: string;
  url: string;
  type: AlertType;
  confidence: AlertConfidence;
  score: number;
  reason: string;
  evidence_json: string;
  reminded_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
  user_vote: number | null;
  claimed_by: string | null;
}

interface DeliveryRow {
  id: string;
  alert_id: string | null;
  channel: string;
  status: string;
  reason: string | null;
  attempted_at: string;
  delivered_at: string | null;
}

function parseEvidenceJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createAlertsRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');

    const [result, deliveriesRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT al.id, al.item_id, a.handle AS account_handle, a.display_name AS account_display_name,
                i.platform, i.title, i.url, al.type, al.confidence, al.score, al.reason,
                al.evidence_json, al.reminded_at, al.acknowledged_at, al.created_at, av.useful AS user_vote,
                (SELECT m.email FROM claims cl
                 LEFT JOIN memberships m ON m.workspace_id = cl.workspace_id AND m.user_id = cl.user_id
                 WHERE cl.workspace_id = al.workspace_id AND cl.item_id = al.item_id
                   AND cl.status IN ('New', 'Claimed', 'Clipping', 'Clipped', 'Published')
                 ORDER BY cl.updated_at DESC LIMIT 1) AS claimed_by
         FROM alerts al
         JOIN items i ON i.id = al.item_id
         JOIN platform_accounts a ON a.id = i.account_id
         LEFT JOIN alert_votes av
           ON av.workspace_id = al.workspace_id AND av.alert_id = al.id AND av.user_id = ?
         WHERE al.workspace_id = ?
         ORDER BY al.created_at DESC, al.id DESC
         LIMIT 100`,
      )
        .bind(principal.userId, principal.workspaceId)
        .all<AlertRow>(),
      c.env.DB.prepare(
        `SELECT id, alert_id, channel, status, reason, attempted_at, delivered_at
         FROM alert_deliveries
         WHERE workspace_id = ? AND alert_id IS NOT NULL
         ORDER BY attempted_at DESC
         LIMIT 500`,
      )
        .bind(principal.workspaceId)
        .all<DeliveryRow>(),
    ]);

    const deliveriesByAlert = new Map<string, AlertDeliveryRecord[]>();
    for (const d of deliveriesRes.results ?? []) {
      if (!d.alert_id) continue;
      const status = alertDeliveryStatusSchema.safeParse(d.status);
      if (!status.success) continue;
      const list = deliveriesByAlert.get(d.alert_id) ?? [];
      list.push({
        id: d.id,
        alertId: d.alert_id,
        channel: d.channel,
        status: status.data,
        reason: d.reason,
        attemptedAt: d.attempted_at,
        deliveredAt: d.delivered_at,
      });
      deliveriesByAlert.set(d.alert_id, list);
    }

    const nowMs = Date.now();
    const hasYtApiKey = Boolean(c.env.YOUTUBE_API_KEY);
    const alerts: AlertItem[] = (result.results ?? []).map((r) => {
      const createdMs = Date.parse(r.created_at);
      return {
        id: r.id,
        itemId: r.item_id,
        accountHandle: normalizeHandle(r.account_handle),
        accountDisplayName: r.account_display_name,
        platform: r.platform,
        title: r.title,
        url: r.url,
        type: r.type,
        confidence: r.confidence,
        score: r.score,
        reason: r.reason,
        evidence: parseEvidenceJson(r.evidence_json),
        userVote: r.user_vote === null ? null : r.user_vote === 1,
        remindedAt: r.reminded_at,
        acknowledgedAt: r.acknowledged_at,
        claimedBy: r.claimed_by,
        deliveries: deliveriesByAlert.get(r.id) ?? [],
        createdAt: r.created_at,
        source: formatProviderSource(r.platform, hasYtApiKey),
        ageSeconds: Number.isFinite(createdMs)
          ? Math.max(0, Math.floor((nowMs - createdMs) / 1000))
          : 0,
      };
    });

    return c.json({
      alerts,
      source: alerts[0]?.source ?? (hasYtApiKey ? 'YouTube API' : 'YouTube RSS'),
      asOf: new Date(nowMs).toISOString(),
    });
  });

  router.post('/:id/vote', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const alertId = c.req.param('id');
    const body = alertVoteSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid vote payload', body.error.flatten());
    }

    const alertExists = await c.env.DB.prepare(
      'SELECT id FROM alerts WHERE id = ? AND workspace_id = ?',
    )
      .bind(alertId, principal.workspaceId)
      .first<{ id: string }>();

    if (!alertExists) {
      throw AppError.notFound('Alert not found');
    }

    const voteId = crypto.randomUUID();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO alert_votes (id, workspace_id, alert_id, user_id, useful, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, alert_id, user_id) DO UPDATE SET useful = excluded.useful`,
    )
      .bind(
        voteId,
        principal.workspaceId,
        alertId,
        principal.userId,
        body.data.useful ? 1 : 0,
        now,
      )
      .run();

    return c.json({
      ok: true,
      alertId,
      useful: body.data.useful,
    });
  });

  router.post('/:id/acknowledge', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const alertId = c.req.param('id');
    const body = acknowledgeAlertSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) {
      throw AppError.badRequest('Invalid acknowledge payload', body.error.flatten());
    }

    const now = new Date().toISOString();
    const res = await c.env.DB.prepare(
      `UPDATE alerts
       SET acknowledged_at = COALESCE(acknowledged_at, ?)
       WHERE id = ? AND workspace_id = ?`,
    )
      .bind(now, alertId, principal.workspaceId)
      .run();

    if ((res.meta?.changes ?? 0) === 0) {
      throw AppError.notFound('Alert not found');
    }

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'alert.acknowledged', 'alert', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        principal.workspaceId,
        principal.userId,
        alertId,
        JSON.stringify({ note: body.data.note ?? null }),
        now,
      )
      .run();

    return c.json({
      ok: true,
      alertId,
      acknowledgedAt: now,
    });
  });

  return router;
}
