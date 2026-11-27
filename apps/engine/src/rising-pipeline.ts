import {
  evaluateRisingV2,
  filterOnShiftRecipients,
  type NotifyQueueMessage,
  type ProviderItem,
  type RisingMatureItem,
  type RisingSnapshot,
} from '@clipse/core';
import { recordAlertDelivery } from './digest.js';
import { processNotifyBatch, type NotifyEnv } from './notify.js';

export interface RisingPipelineEnv extends NotifyEnv {
  readonly NOTIFY_QUEUE?: Queue;
}

interface MemberShiftRow {
  user_id: string;
  availability_json: string | null;
  timezone: string | null;
}

async function loadMatureCreatorItems(
  db: D1Database,
  channelId: string,
  sevenDaysAgoIso: string,
): Promise<RisingMatureItem[]> {
  const res = await db
    .prepare(
      `SELECT i.kind, i.published_at,
              (SELECT s.views FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS views,
              (SELECT s.likes FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS likes
       FROM items i
       INNER JOIN platform_accounts a ON a.id = i.account_id
       WHERE a.platform = 'youtube' AND a.external_id = ? AND i.published_at < ?
       ORDER BY i.published_at DESC
       LIMIT 40`,
    )
    .bind(channelId, sevenDaysAgoIso)
    .all<{
      kind: 'video' | 'short' | 'live' | 'vod' | 'clip';
      published_at: string;
      views: number | null;
      likes: number | null;
    }>();

  return (res.results ?? [])
    .filter((r) => r.views !== null)
    .map((r) => ({
      kind: r.kind,
      publishedAt: r.published_at,
      views: r.views ?? 0,
      likes: r.likes,
    }));
}

async function loadItemSnapshots(db: D1Database, itemId: string): Promise<RisingSnapshot[]> {
  const res = await db
    .prepare(
      `SELECT captured_at, views, likes, comments
       FROM item_stats
       WHERE item_id = ?
       ORDER BY captured_at ASC
       LIMIT 24`,
    )
    .bind(itemId)
    .all<{
      captured_at: string;
      views: number;
      likes: number | null;
      comments: number | null;
    }>();

  return (res.results ?? []).map((r) => ({
    capturedAt: r.captured_at,
    views: r.views,
    likes: r.likes,
    comments: r.comments,
  }));
}

/**
 * Evaluates Rising v2 across synced items using >=5 >7d same-kind baseline items,
 * snapshot-delta velocity (>=2 snapshots >=10m apart), backfill protection,
 * on-shift recipient routing, and alert_deliveries lifecycle logging.
 */
export async function evaluateAndDispatchRisingAlerts(
  db: D1Database,
  env: RisingPipelineEnv,
  channelId: string,
  originalExternalId: string,
  items: readonly ProviderItem[],
  nowIso: string,
): Promise<void> {
  if (items.length === 0) return;

  const followers = await db
    .prepare(
      `SELECT DISTINCT f.workspace_id
       FROM follows f
       INNER JOIN platform_accounts a ON a.id = f.account_id
       WHERE a.platform = 'youtube' AND (a.external_id = ? OR a.external_id = ?)`,
    )
    .bind(channelId, originalExternalId)
    .all<{ workspace_id: string }>();

  const workspaceIds = (followers.results ?? []).map((r) => r.workspace_id);
  if (workspaceIds.length === 0) return;

  const nowMs = Date.parse(nowIso);
  const sevenDaysAgoIso = new Date(nowMs - 7 * 86_400_000).toISOString();
  const creatorItems = await loadMatureCreatorItems(db, channelId, sevenDaysAgoIso);

  for (const item of items) {
    const itemId = `item:youtube:${item.externalId}`;
    const itemMeta = await db
      .prepare('SELECT is_backfill FROM items WHERE id = ? LIMIT 1')
      .bind(itemId)
      .first<{ is_backfill: number }>();
    const isBackfill = itemMeta?.is_backfill === 1;

    const snapshots = await loadItemSnapshots(db, itemId);
    const evalResult = evaluateRisingV2({
      kind: item.kind,
      publishedAt: item.publishedAt,
      evaluatedAt: nowIso,
      isBackfill,
      snapshots,
      creatorItems,
    });

    if (evalResult.tier === 'none') continue;

    const confidence =
      evalResult.tier === 'viral' ? 'high' : evalResult.tier === 'breakout' ? 'medium' : 'low';

    for (const workspaceId of workspaceIds) {
      const alertId = `alert:${workspaceId}:${itemId}:${evalResult.tier}`;
      const existing = await db
        .prepare('SELECT id FROM alerts WHERE workspace_id = ? AND item_id = ? AND type = ? LIMIT 1')
        .bind(workspaceId, itemId, evalResult.tier)
        .first<{ id: string }>();
      if (existing) continue;

      await db
        .prepare(
          `INSERT INTO alerts (id, workspace_id, item_id, type, confidence, score, reason, evidence_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          alertId,
          workspaceId,
          itemId,
          evalResult.tier,
          confidence,
          evalResult.score,
          evalResult.reason,
          JSON.stringify({
            velocityRatio: evalResult.velocityRatio,
            engagementRatio: evalResult.engagementRatio,
            baselineN: evalResult.baselineN,
            paceLabel: evalResult.paceLabel,
          }),
          nowIso,
        )
        .run();

      await recordAlertDelivery(db, {
        id: `deliv:detected:${alertId}`,
        workspaceId,
        alertId,
        channel: 'engine',
        status: 'detected',
        reason: evalResult.reason,
        attemptedAt: nowIso,
      });

      const membersRes = await db
        .prepare('SELECT user_id, availability_json, timezone FROM memberships WHERE workspace_id = ?')
        .bind(workspaceId)
        .all<MemberShiftRow>();

      const routing = filterOnShiftRecipients(
        (membersRes.results ?? []).map((m) => ({
          userId: m.user_id,
          availabilityJson: m.availability_json,
          timezone: m.timezone,
        })),
        nowIso,
      );

      for (const offMember of routing.offShiftRecipients) {
        await recordAlertDelivery(db, {
          id: `deliv:offshift:${alertId}:${offMember.userId}`,
          workspaceId,
          alertId,
          channel: 'notify',
          status: 'suppressed',
          reason: 'off_shift_digest',
          attemptedAt: nowIso,
        });
      }

      const notifyMessages: NotifyQueueMessage[] = routing.primaryRecipients.map((m) => ({
        type: 'dispatch_alert',
        idempotencyKey: `${alertId}:${m.userId}`,
        workspaceId,
        userId: m.userId,
        alertId,
        alertType: evalResult.tier === 'none' ? 'rising' : evalResult.tier,
        confidence,
        title: item.title,
        body: evalResult.reason,
        deepLinkUrl: item.url.startsWith('https://') ? item.url : undefined,
        isEscalation: false,
        createdAt: nowIso,
      }));

      if (notifyMessages.length === 0) continue;

      for (const nMsg of notifyMessages) {
        await recordAlertDelivery(db, {
          id: `deliv:queued:${nMsg.idempotencyKey}`,
          workspaceId,
          alertId,
          channel: 'notify',
          status: 'queued',
          reason: routing.usedFallback ? 'on_shift_fallback_all' : 'on_shift_routed',
          attemptedAt: nowIso,
        });
      }

      if (env.NOTIFY_QUEUE) {
        await env.NOTIFY_QUEUE.sendBatch(notifyMessages.map((body) => ({ body })));
      } else {
        await processNotifyBatch(db, env, notifyMessages, { nowIso });
      }
    }
  }
}
