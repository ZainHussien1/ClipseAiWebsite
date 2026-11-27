import { Hono } from 'hono';
import {
  AppError,
  auditLogQuerySchema,
  dlqRetrySchema,
  hasRoleAtLeast,
  type AdminHealthData,
  type AuditLogEntry,
  type DataQualityReport,
  type DlqItem,
  type Platform,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';

const D1_DAILY_READ_LIMIT = 5_000_000;
const D1_DAILY_WRITE_LIMIT = 100_000;

export function createAdminRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/health', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('Admin health requires Admin or Owner role');
    }

    const wsId = principal.workspaceId;
    const todayPrefix = `${new Date().toISOString().slice(0, 10)}%`;
    const todayDate = new Date().toISOString().slice(0, 10);

    const [
      writesRows,
      readsRows,
      queuedRow,
      dlqRows,
      cronRow,
      syncRow,
      deliveryCounts,
      recentErrorsRes,
    ] = await Promise.all([
      c.env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM items WHERE first_seen_at LIKE ?) +
           (SELECT COUNT(*) FROM item_stats WHERE captured_at LIKE ?) +
           (SELECT COUNT(*) FROM live_samples WHERE sampled_at LIKE ?) +
           (SELECT COUNT(*) FROM alert_deliveries WHERE workspace_id = ? AND attempted_at LIKE ?) +
           (SELECT COUNT(*) FROM audit_logs WHERE workspace_id = ? AND created_at LIKE ?) +
           (SELECT COUNT(*) FROM notifications WHERE workspace_id = ? AND created_at LIKE ?) +
           (SELECT COUNT(*) FROM claims WHERE workspace_id = ? AND updated_at LIKE ?) +
           (SELECT COUNT(*) FROM clips WHERE workspace_id = ? AND updated_at LIKE ?) AS writes_today`,
      )
        .bind(
          todayPrefix,
          todayPrefix,
          todayPrefix,
          wsId,
          todayPrefix,
          wsId,
          todayPrefix,
          wsId,
          todayPrefix,
          wsId,
          todayPrefix,
          wsId,
          todayPrefix,
        )
        .first<{ writes_today: number }>(),
      c.env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM items) +
           (SELECT COUNT(*) FROM item_stats) +
           (SELECT COUNT(*) FROM alerts WHERE workspace_id = ?) +
           (SELECT COUNT(*) FROM audit_logs WHERE workspace_id = ?) AS stored_rows`,
      )
        .bind(wsId, wsId)
        .first<{ stored_rows: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM alert_deliveries WHERE workspace_id = ? AND status = 'queued'`,
      )
        .bind(wsId)
        .first<{ cnt: number }>(),
      c.env.DB.prepare(
        `SELECT id, queue_name, error_reason, status, attempts, created_at, retried_at
         FROM dlq_messages
         WHERE workspace_id = ? OR workspace_id IS NULL
         ORDER BY created_at DESC
         LIMIT 25`,
      )
        .bind(wsId)
        .all<{
          id: string;
          queue_name: 'ingest-dlq' | 'notify-dlq';
          error_reason: string;
          status: 'pending' | 'retried' | 'discarded';
          attempts: number;
          created_at: string;
          retried_at: string | null;
        }>(),
      c.env.DB.prepare(
        `SELECT MAX(updated_at) AS last_run,
                COALESCE(SUM(CASE WHEN metric_date = ? THEN reconcile_runs ELSE 0 END), 0) AS runs_today
         FROM ingestion_metrics`,
      )
        .bind(todayDate)
        .first<{ last_run: string | null; runs_today: number }>(),
      c.env.DB.prepare(
        'SELECT MAX(last_synced_at) AS last_sync FROM platform_accounts',
      ).first<{ last_sync: string | null }>(),
      c.env.DB.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_cnt,
           COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_cnt,
           COALESCE(SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END), 0) AS suppressed_cnt
         FROM alert_deliveries
         WHERE workspace_id = ?`,
      )
        .bind(wsId)
        .first<{ delivered_cnt: number; failed_cnt: number; suppressed_cnt: number }>(),
      c.env.DB.prepare(
        `SELECT id, channel, reason, attempted_at
         FROM alert_deliveries
         WHERE workspace_id = ? AND status = 'failed'
         ORDER BY attempted_at DESC
         LIMIT 10`,
      )
        .bind(wsId)
        .all<{
          id: string;
          channel: string;
          reason: string | null;
          attempted_at: string;
        }>(),
    ]);

    const writesTodayEstimate = writesRows?.writes_today ?? 0;
    const readsTodayEstimate = readsRows?.stored_rows ?? 0;
    const dlqItems: DlqItem[] = (dlqRows.results ?? []).map((r) => ({
      id: r.id,
      queueName: r.queue_name,
      errorReason: r.error_reason,
      status: r.status,
      attempts: r.attempts,
      createdAt: r.created_at,
      retriedAt: r.retried_at,
    }));

    const deliveredCount = deliveryCounts?.delivered_cnt ?? 0;
    const failedCount = deliveryCounts?.failed_cnt ?? 0;
    const suppressedCount = deliveryCounts?.suppressed_cnt ?? 0;
    const totalAttempts = deliveredCount + failedCount;

    const health: AdminHealthData = {
      d1: {
        readsTodayEstimate,
        writesTodayEstimate,
        dailyReadLimit: D1_DAILY_READ_LIMIT,
        dailyWriteLimit: D1_DAILY_WRITE_LIMIT,
        degraded: writesTodayEstimate >= Math.floor(D1_DAILY_WRITE_LIMIT * 0.85),
      },
      queues: {
        ingestQueueDepth: 0,
        notifyQueueDepth: queuedRow?.cnt ?? 0,
        ingestDlqCount: dlqItems.filter(
          (d) => d.queueName === 'ingest-dlq' && d.status === 'pending',
        ).length,
        notifyDlqCount: dlqItems.filter(
          (d) => d.queueName === 'notify-dlq' && d.status === 'pending',
        ).length,
        dlqItems,
      },
      cron: {
        lastRunAt: cronRow?.last_run ?? null,
        lastSyncAt: syncRow?.last_sync ?? null,
        reconcileRunsToday: cronRow?.runs_today ?? 0,
      },
      delivery: {
        deliveredCount,
        failedCount,
        suppressedCount,
        successRate:
          totalAttempts > 0
            ? Math.round((deliveredCount / totalAttempts) * 1000) / 1000
            : null,
        recentErrors: (recentErrorsRes.results ?? []).map((e) => ({
          id: e.id,
          channel: e.channel,
          reason: e.reason,
          attemptedAt: e.attempted_at,
        })),
      },
      source: 'd1',
      asOf: new Date().toISOString(),
    };

    return c.json(health);
  });

  router.post('/dlq/retry', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('DLQ retry requires Admin or Owner role');
    }

    const body = dlqRetrySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      throw AppError.badRequest('Invalid DLQ retry payload', body.error.flatten());
    }

    const wsId = principal.workspaceId;
    const nowIso = new Date().toISOString();
    let retriedCount = 0;

    if (body.data.id) {
      const target = await c.env.DB.prepare(
        `SELECT id, queue_name, payload_json
         FROM dlq_messages
         WHERE id = ? AND (workspace_id = ? OR workspace_id IS NULL)`,
      )
        .bind(body.data.id, wsId)
        .first<{ id: string; queue_name: string; payload_json: string }>();

      if (!target) {
        throw AppError.notFound('DLQ message not found');
      }

      if (target.queue_name === 'ingest-dlq' && c.env.INGEST_QUEUE) {
        try {
          await c.env.INGEST_QUEUE.send(JSON.parse(target.payload_json));
        } catch {
          // Best-effort re-enqueue; D1 status still updates
        }
      } else if (target.queue_name === 'notify-dlq' && c.env.NOTIFY_QUEUE) {
        try {
          await c.env.NOTIFY_QUEUE.send(JSON.parse(target.payload_json));
        } catch {
          // Best-effort re-enqueue
        }
      }

      const res = await c.env.DB.prepare(
        `UPDATE dlq_messages
         SET status = 'retried', attempts = attempts + 1, retried_at = ?
         WHERE id = ?`,
      )
        .bind(nowIso, target.id)
        .run();
      retriedCount = res.meta?.changes ?? 0;
    } else {
      const conditions = [
        "status = 'pending'",
        '(workspace_id = ? OR workspace_id IS NULL)',
      ];
      const params: unknown[] = [nowIso, wsId];
      if (body.data.queueName) {
        conditions.push('queue_name = ?');
        params.push(body.data.queueName);
      }

      const res = await c.env.DB.prepare(
        `UPDATE dlq_messages
         SET status = 'retried', attempts = attempts + 1, retried_at = ?
         WHERE ${conditions.join(' AND ')}`,
      )
        .bind(...params)
        .run();
      retriedCount = res.meta?.changes ?? 0;
    }

    const remRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM dlq_messages
       WHERE status = 'pending' AND (workspace_id = ? OR workspace_id IS NULL)`,
    )
      .bind(wsId)
      .first<{ cnt: number }>();

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'dlq.retried', 'dlq', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        wsId,
        principal.userId,
        body.data.id ?? body.data.queueName ?? 'all',
        JSON.stringify({ retriedCount }),
        nowIso,
      )
      .run();

    return c.json({
      ok: true,
      retriedCount,
      remainingPending: remRow?.cnt ?? 0,
    });
  });

  router.get('/audit-log', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('Audit log requires Admin or Owner role');
    }

    const query = auditLogQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      throw AppError.badRequest('Invalid audit log query', query.error.flatten());
    }

    const conditions: string[] = ['a.workspace_id = ?'];
    const params: unknown[] = [principal.workspaceId];

    if (query.data.action) {
      conditions.push('a.action LIKE ?');
      params.push(`${query.data.action}%`);
    }
    if (query.data.actorUserId) {
      conditions.push('a.actor_user_id = ?');
      params.push(query.data.actorUserId);
    }
    if (query.data.from) {
      conditions.push('a.created_at >= ?');
      params.push(query.data.from);
    }
    if (query.data.to) {
      conditions.push('a.created_at <= ?');
      params.push(
        query.data.to.length === 10 ? `${query.data.to}T23:59:59.999Z` : query.data.to,
      );
    }
    params.push(query.data.limit);

    const rows = await c.env.DB.prepare(
      `SELECT a.id, a.actor_user_id, m.email AS actor_email, a.action,
              a.target_type, a.target_id, a.metadata_json, a.created_at
       FROM audit_logs a
       LEFT JOIN memberships m ON m.workspace_id = a.workspace_id AND m.user_id = a.actor_user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
    )
      .bind(...params)
      .all<{
        id: string;
        actor_user_id: string;
        actor_email: string | null;
        action: string;
        target_type: string;
        target_id: string;
        metadata_json: string;
        created_at: string;
      }>();

    const entries: AuditLogEntry[] = (rows.results ?? []).map((r) => {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(r.metadata_json) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        metadata = {};
      }
      return {
        id: r.id,
        actorUserId: r.actor_user_id,
        actorEmail: r.actor_email,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        metadata,
        createdAt: r.created_at,
      };
    });

    return c.json({
      entries,
      source: 'd1',
      asOf: new Date().toISOString(),
    });
  });

  router.get('/data-quality', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('Data quality requires Admin or Owner role');
    }

    const wsId = principal.workspaceId;
    const staleCutoffIso = new Date(Date.now() - 24 * 3_600_000).toISOString();

    const [
      missingDurRows,
      missingDurCnt,
      unclassRows,
      unclassCnt,
      staleRows,
      staleCnt,
      orphanRows,
      orphanCnt,
    ] = await Promise.all([
      c.env.DB.prepare(
        `SELECT i.id AS item_id, i.title, a.display_name AS creator_name, i.platform, i.published_at
         FROM items i
         JOIN platform_accounts a ON a.id = i.account_id
         JOIN follows f ON f.account_id = a.id
         WHERE f.workspace_id = ? AND f.archived = 0
           AND i.duration_sec IS NULL AND i.kind IN ('video', 'short', 'vod')
         ORDER BY i.published_at DESC LIMIT 25`,
      )
        .bind(wsId)
        .all<{
          item_id: string;
          title: string;
          creator_name: string;
          platform: Platform;
          published_at: string;
        }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt
         FROM items i
         JOIN follows f ON f.account_id = i.account_id
         WHERE f.workspace_id = ? AND f.archived = 0
           AND i.duration_sec IS NULL AND i.kind IN ('video', 'short', 'vod')`,
      )
        .bind(wsId)
        .first<{ cnt: number }>(),
      c.env.DB.prepare(
        `SELECT i.id AS item_id, i.title, a.display_name AS creator_name, i.platform, i.published_at
         FROM items i
         JOIN platform_accounts a ON a.id = i.account_id
         JOIN follows f ON f.account_id = a.id
         WHERE f.workspace_id = ? AND f.archived = 0
           AND i.shorts_classification = 'unclassified'
         ORDER BY i.published_at DESC LIMIT 25`,
      )
        .bind(wsId)
        .all<{
          item_id: string;
          title: string;
          creator_name: string;
          platform: Platform;
          published_at: string;
        }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt
         FROM items i
         JOIN follows f ON f.account_id = i.account_id
         WHERE f.workspace_id = ? AND f.archived = 0
           AND i.shorts_classification = 'unclassified'`,
      )
        .bind(wsId)
        .first<{ cnt: number }>(),
      c.env.DB.prepare(
        `SELECT f.id AS follow_id, a.id AS account_id, a.display_name, a.handle, a.platform, a.last_synced_at
         FROM follows f
         JOIN platform_accounts a ON a.id = f.account_id
         WHERE f.workspace_id = ? AND f.archived = 0 AND f.paused = 0
           AND (a.last_synced_at IS NULL OR a.last_synced_at < ?)
         ORDER BY a.last_synced_at ASC LIMIT 25`,
      )
        .bind(wsId, staleCutoffIso)
        .all<{
          follow_id: string;
          account_id: string;
          display_name: string;
          handle: string;
          platform: Platform;
          last_synced_at: string | null;
        }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt
         FROM follows f
         JOIN platform_accounts a ON a.id = f.account_id
         WHERE f.workspace_id = ? AND f.archived = 0 AND f.paused = 0
           AND (a.last_synced_at IS NULL OR a.last_synced_at < ?)`,
      )
        .bind(wsId, staleCutoffIso)
        .first<{ cnt: number }>(),
      c.env.DB.prepare(
        `SELECT cl.id AS claim_id, cl.item_id, i.title, cl.status, cl.user_id, cl.created_at
         FROM claims cl
         JOIN items i ON i.id = cl.item_id
         WHERE cl.workspace_id = ?
           AND (
             NOT EXISTS (
               SELECT 1 FROM follows f
               WHERE f.workspace_id = cl.workspace_id
                 AND f.account_id = i.account_id
                 AND f.archived = 0
             )
             OR NOT EXISTS (
               SELECT 1 FROM memberships m
               WHERE m.workspace_id = cl.workspace_id
                 AND m.user_id = cl.user_id
             )
           )
         ORDER BY cl.created_at DESC LIMIT 25`,
      )
        .bind(wsId)
        .all<{
          claim_id: string;
          item_id: string;
          title: string;
          status: string;
          user_id: string;
          created_at: string;
        }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt
         FROM claims cl
         JOIN items i ON i.id = cl.item_id
         WHERE cl.workspace_id = ?
           AND (
             NOT EXISTS (
               SELECT 1 FROM follows f
               WHERE f.workspace_id = cl.workspace_id
                 AND f.account_id = i.account_id
                 AND f.archived = 0
             )
             OR NOT EXISTS (
               SELECT 1 FROM memberships m
               WHERE m.workspace_id = cl.workspace_id
                 AND m.user_id = cl.user_id
             )
           )`,
      )
        .bind(wsId)
        .first<{ cnt: number }>(),
    ]);

    const report: DataQualityReport = {
      counts: {
        missingDuration: missingDurCnt?.cnt ?? 0,
        unclassifiedShorts: unclassCnt?.cnt ?? 0,
        staleSources: staleCnt?.cnt ?? 0,
        orphanClaims: orphanCnt?.cnt ?? 0,
      },
      missingDuration: (missingDurRows.results ?? []).map((r) => ({
        itemId: r.item_id,
        title: r.title,
        creatorName: r.creator_name,
        platform: r.platform,
        publishedAt: r.published_at,
      })),
      unclassifiedShorts: (unclassRows.results ?? []).map((r) => ({
        itemId: r.item_id,
        title: r.title,
        creatorName: r.creator_name,
        platform: r.platform,
        publishedAt: r.published_at,
      })),
      staleSources: (staleRows.results ?? []).map((r) => ({
        followId: r.follow_id,
        accountId: r.account_id,
        displayName: r.display_name,
        handle: r.handle,
        platform: r.platform,
        lastSyncedAt: r.last_synced_at,
      })),
      orphanClaims: (orphanRows.results ?? []).map((r) => ({
        claimId: r.claim_id,
        itemId: r.item_id,
        title: r.title,
        status: r.status,
        userId: r.user_id,
        createdAt: r.created_at,
      })),
      source: 'd1',
      asOf: new Date().toISOString(),
    };

    return c.json(report);
  });

  return router;
}
