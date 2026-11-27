import { Hono } from 'hono';
import {
  AppError,
  claimStatusSchema,
  feedQuerySchema,
  formatProviderSource,
  markSeenSchema,
  normalizeHandle,
  risingTierSchema,
  type FeedCreatorRailItem,
  type FeedItem,
  type ItemClaimInfo,
  type ItemDetail,
  type Platform,
} from '@clipse/core';
import { z } from 'zod';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { requireWriterRole } from '../auth.js';

const cursorPayloadSchema = z.object({
  p: z.string().min(1),
  id: z.string().min(1),
  s: z.number().optional(),
  v: z.number().optional(),
});

interface FeedRow {
  id: string;
  account_id: string;
  account_handle: string;
  account_display_name: string;
  platform: Platform;
  external_id: string;
  kind: 'video' | 'short' | 'live' | 'vod' | 'clip';
  shorts_classification: 'video' | 'short' | 'live' | 'unclassified' | null;
  title: string;
  url: string;
  thumbnail_url: string | null;
  published_at: string;
  first_seen_at: string;
  is_backfill: number;
  is_seen: number;
  duration_sec: number | null;
  latest_views: number | null;
  latest_likes: number | null;
  latest_comments: number | null;
  snapshot_count: number;
  rising_score: number | null;
  rising_tier: string | null;
  rising_reason: string | null;
  claim_id: string | null;
  claim_status: string | null;
  claim_user_id: string | null;
}

const AGE_HOURS: Record<'6h' | '24h' | '72h' | '7d', number> = {
  '6h': 6,
  '24h': 24,
  '72h': 72,
  '7d': 168,
};

function encodeCursor(p: string, id: string, extra?: { s?: number; v?: number }): string {
  return btoa(JSON.stringify({ p, id, ...extra }));
}

function decodeCursor(raw: string): z.infer<typeof cursorPayloadSchema> {
  try {
    return cursorPayloadSchema.parse(JSON.parse(atob(raw)));
  } catch {
    throw AppError.badRequest('Invalid pagination cursor');
  }
}

function computeDayGroup(publishedAt: string, nowMs: number): string {
  const day = publishedAt.slice(0, 10);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const yesterday = new Date(nowMs - 86_400_000).toISOString().slice(0, 10);
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  return day;
}

function lanePredicate(lane: 'videos' | 'shorts' | 'live' | 'unclassified'): string {
  if (lane === 'videos') {
    return "(i.shorts_classification = 'video' OR (i.shorts_classification IS NULL AND i.kind IN ('video', 'vod')))";
  }
  if (lane === 'shorts') {
    return "(i.shorts_classification = 'short' OR (i.shorts_classification IS NULL AND i.kind IN ('short', 'clip')))";
  }
  if (lane === 'live') {
    return "(i.shorts_classification = 'live' OR (i.shorts_classification IS NULL AND i.kind = 'live'))";
  }
  return "i.shorts_classification = 'unclassified'";
}

function mapFeedRow(
  r: FeedRow,
  emailByUserId: Map<string, string>,
  myUserId: string,
  nowMs: number,
  hasYtApiKey: boolean,
): FeedItem {
  const pubMs = Date.parse(r.published_at);
  const seenMs = Date.parse(r.first_seen_at);
  const latency =
    Number.isFinite(pubMs) && Number.isFinite(seenMs)
      ? Math.max(0, seenMs - pubMs)
      : null;
  const ageSeconds = Number.isFinite(seenMs)
    ? Math.max(0, Math.floor((nowMs - seenMs) / 1000))
    : 0;
  const parsedClaim = r.claim_status
    ? claimStatusSchema.safeParse(r.claim_status)
    : null;
  const parsedTier = r.rising_tier
    ? risingTierSchema.exclude(['none']).safeParse(r.rising_tier)
    : null;

  const claim: ItemClaimInfo | null =
    r.claim_id && parsedClaim?.success && r.claim_user_id
      ? {
          id: r.claim_id,
          status: parsedClaim.data,
          userId: r.claim_user_id,
          email: emailByUserId.get(r.claim_user_id) ?? null,
          claimedByMe: r.claim_user_id === myUserId,
        }
      : null;

  return {
    id: r.id,
    accountId: r.account_id,
    accountHandle: normalizeHandle(r.account_handle),
    accountDisplayName: r.account_display_name,
    platform: r.platform,
    externalId: r.external_id,
    kind: r.kind,
    shortsClassification: r.shorts_classification,
    title: r.title,
    url: r.url,
    thumbnailUrl: r.thumbnail_url,
    publishedAt: r.published_at,
    firstSeenAt: r.first_seen_at,
    dayGroup: computeDayGroup(r.published_at, nowMs),
    isBackfill: r.is_backfill === 1,
    isSeen: r.is_seen === 1,
    durationSec: r.duration_sec,
    ingestLatencyMs: latency,
    latestViews: r.latest_views,
    latestLikes: r.latest_likes,
    latestComments: r.latest_comments,
    snapshotCount: r.snapshot_count ?? 0,
    risingScore: r.rising_score,
    risingTier: parsedTier?.success ? parsedTier.data : null,
    risingReason: r.rising_reason,
    claimStatus: parsedClaim?.success ? parsedClaim.data : null,
    claim,
    source: formatProviderSource(r.platform, hasYtApiKey),
    ageSeconds,
  };
}

export function createFeedRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');
    const query = feedQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      throw AppError.badRequest('Invalid feed query', query.error.flatten());
    }

    const {
      cursor,
      limit,
      platform,
      kind,
      lane,
      sort,
      age,
      minViews,
      unseenOnly,
      accountId,
      starredOnly,
      q,
    } = query.data;
    const cursorVal = cursor ? decodeCursor(cursor) : null;
    const nowMs = Date.now();

    const baseConditions: string[] = [
      'f.workspace_id = ?',
      'f.archived = 0',
      'f.paused = 0',
    ];
    const baseParams: unknown[] = [principal.workspaceId];

    if (platform) {
      baseConditions.push('i.platform = ?');
      baseParams.push(platform);
    }
    if (kind) {
      baseConditions.push('i.kind = ?');
      baseParams.push(kind);
    }
    if (accountId) {
      baseConditions.push('i.account_id = ?');
      baseParams.push(accountId);
    }
    if (starredOnly) {
      baseConditions.push('f.starred = 1');
    }
    if (age) {
      baseConditions.push('i.published_at >= ?');
      baseParams.push(new Date(nowMs - AGE_HOURS[age] * 3_600_000).toISOString());
    }
    if (minViews !== undefined) {
      baseConditions.push(
        'COALESCE((SELECT s.views FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1), 0) >= ?',
      );
      baseParams.push(minViews);
    }
    if (q) {
      baseConditions.push('LOWER(i.title) LIKE ?');
      baseParams.push(`%${q.toLowerCase()}%`);
    }

    const conditions = [...baseConditions];
    const filterParams = [...baseParams];
    if (lane) {
      conditions.push(lanePredicate(lane));
    }
    if (unseenOnly) {
      conditions.push(
        'NOT EXISTS (SELECT 1 FROM item_seen ise WHERE ise.workspace_id = ? AND ise.user_id = ? AND ise.item_id = i.id)',
      );
      filterParams.push(principal.workspaceId, principal.userId);
    }

    if (cursorVal) {
      if (sort === 'rising' && cursorVal.s !== undefined) {
        conditions.push(
          `(COALESCE((SELECT al.score FROM alerts al WHERE al.workspace_id = ? AND al.item_id = i.id AND al.type IN ('rising','breakout','viral') ORDER BY al.score DESC LIMIT 1), -1) < ? OR (COALESCE((SELECT al.score FROM alerts al WHERE al.workspace_id = ? AND al.item_id = i.id AND al.type IN ('rising','breakout','viral') ORDER BY al.score DESC LIMIT 1), -1) = ? AND (i.published_at < ? OR (i.published_at = ? AND i.id < ?))))`,
        );
        filterParams.push(
          principal.workspaceId,
          cursorVal.s,
          principal.workspaceId,
          cursorVal.s,
          cursorVal.p,
          cursorVal.p,
          cursorVal.id,
        );
      } else if (sort === 'views' && cursorVal.v !== undefined) {
        conditions.push(
          `(COALESCE((SELECT s.views FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1), -1) < ? OR (COALESCE((SELECT s.views FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1), -1) = ? AND (i.published_at < ? OR (i.published_at = ? AND i.id < ?))))`,
        );
        filterParams.push(
          cursorVal.v,
          cursorVal.v,
          cursorVal.p,
          cursorVal.p,
          cursorVal.id,
        );
      } else {
        conditions.push('(i.published_at < ? OR (i.published_at = ? AND i.id < ?))');
        filterParams.push(cursorVal.p, cursorVal.p, cursorVal.id);
      }
    }

    const orderBy =
      sort === 'rising'
        ? 'ORDER BY COALESCE(rising_score, -1) DESC, i.published_at DESC, i.id DESC'
        : sort === 'views'
          ? 'ORDER BY COALESCE(latest_views, -1) DESC, i.published_at DESC, i.id DESC'
          : 'ORDER BY i.published_at DESC, i.id DESC';

    const selectParams = [
      principal.workspaceId,
      principal.userId,
      principal.workspaceId,
      principal.workspaceId,
      principal.workspaceId,
      principal.workspaceId,
      principal.workspaceId,
      principal.workspaceId,
      ...filterParams,
      limit + 1,
    ];

    const sql = `
      SELECT i.id, i.account_id, a.handle AS account_handle, a.display_name AS account_display_name,
             i.platform, i.external_id, i.kind, i.shorts_classification, i.title, i.url, i.thumbnail_url,
             i.published_at, i.first_seen_at, i.is_backfill, i.duration_sec,
             EXISTS(SELECT 1 FROM item_seen ise WHERE ise.workspace_id = ? AND ise.user_id = ? AND ise.item_id = i.id) AS is_seen,
             (SELECT s.views FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_views,
             (SELECT s.likes FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_likes,
             (SELECT s.comments FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_comments,
             (SELECT COUNT(*) FROM item_stats s WHERE s.item_id = i.id) AS snapshot_count,
             (SELECT al.score FROM alerts al WHERE al.workspace_id = ? AND al.item_id = i.id AND al.type IN ('rising','breakout','viral') ORDER BY al.score DESC LIMIT 1) AS rising_score,
             (SELECT al.type FROM alerts al WHERE al.workspace_id = ? AND al.item_id = i.id AND al.type IN ('rising','breakout','viral') ORDER BY al.score DESC LIMIT 1) AS rising_tier,
             (SELECT al.reason FROM alerts al WHERE al.workspace_id = ? AND al.item_id = i.id AND al.type IN ('rising','breakout','viral') ORDER BY al.score DESC LIMIT 1) AS rising_reason,
             (SELECT cl.id FROM claims cl WHERE cl.workspace_id = ? AND cl.item_id = i.id AND cl.status IN ('New', 'Claimed', 'Clipping', 'Clipped', 'Published') ORDER BY cl.updated_at DESC LIMIT 1) AS claim_id,
             (SELECT cl.status FROM claims cl WHERE cl.workspace_id = ? AND cl.item_id = i.id AND cl.status IN ('New', 'Claimed', 'Clipping', 'Clipped', 'Published') ORDER BY cl.updated_at DESC LIMIT 1) AS claim_status,
             (SELECT cl.user_id FROM claims cl WHERE cl.workspace_id = ? AND cl.item_id = i.id AND cl.status IN ('New', 'Claimed', 'Clipping', 'Clipped', 'Published') ORDER BY cl.updated_at DESC LIMIT 1) AS claim_user_id
      FROM items i
      JOIN platform_accounts a ON a.id = i.account_id
      JOIN follows f ON f.account_id = a.id
      WHERE ${conditions.join(' AND ')}
      ${orderBy}
      LIMIT ?
    `;

    const [result, membersRes, laneRows, railRows] = await Promise.all([
      c.env.DB.prepare(sql).bind(...selectParams).all<FeedRow>(),
      c.env.DB.prepare('SELECT user_id, email FROM memberships WHERE workspace_id = ?')
        .bind(principal.workspaceId)
        .all<{ user_id: string; email: string }>(),
      c.env.DB.prepare(
        `SELECT i.kind, i.shorts_classification
         FROM items i
         JOIN platform_accounts a ON a.id = i.account_id
         JOIN follows f ON f.account_id = a.id
         WHERE ${baseConditions.join(' AND ')}`,
      )
        .bind(...baseParams)
        .all<{ kind: string; shorts_classification: string | null }>(),
      c.env.DB.prepare(
        `SELECT a.id AS account_id, a.handle, a.display_name, a.platform, f.starred,
                (SELECT COUNT(*) FROM items i2
                 WHERE i2.account_id = a.id
                   AND NOT EXISTS (
                     SELECT 1 FROM item_seen ise
                     WHERE ise.workspace_id = f.workspace_id AND ise.user_id = ? AND ise.item_id = i2.id
                   )) AS unseen_count
         FROM follows f
         JOIN platform_accounts a ON a.id = f.account_id
         WHERE f.workspace_id = ? AND f.archived = 0 AND f.paused = 0
         ORDER BY f.starred DESC, unseen_count DESC, a.display_name ASC`,
      )
        .bind(principal.userId, principal.workspaceId)
        .all<{
          account_id: string;
          handle: string;
          display_name: string;
          platform: Platform;
          starred: number;
          unseen_count: number;
        }>(),
    ]);

    const emailByUserId = new Map(
      (membersRes.results ?? []).map((m) => [m.user_id, m.email]),
    );

    const laneCounts = { videos: 0, shorts: 0, live: 0, unclassified: 0 };
    for (const lr of laneRows.results ?? []) {
      const cls = lr.shorts_classification;
      if (cls === 'unclassified') laneCounts.unclassified += 1;
      else if (cls === 'short' || (!cls && (lr.kind === 'short' || lr.kind === 'clip')))
        laneCounts.shorts += 1;
      else if (cls === 'live' || (!cls && lr.kind === 'live')) laneCounts.live += 1;
      else laneCounts.videos += 1;
    }

    const creatorsRail: FeedCreatorRailItem[] = (railRows.results ?? []).map((r) => ({
      accountId: r.account_id,
      handle: normalizeHandle(r.handle),
      displayName: r.display_name,
      platform: r.platform,
      unseenCount: r.unseen_count,
      starred: r.starred === 1,
    }));

    const rows = result.results ?? [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const hasYtApiKey = Boolean(c.env.YOUTUBE_API_KEY);

    const items = pageRows.map((r) =>
      mapFeedRow(r, emailByUserId, principal.userId, nowMs, hasYtApiKey),
    );

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(last.published_at, last.id, {
            s: sort === 'rising' ? (last.rising_score ?? -1) : undefined,
            v: sort === 'views' ? (last.latest_views ?? -1) : undefined,
          })
        : null;

    return c.json({
      items,
      nextCursor,
      laneCounts,
      creatorsRail,
      source: items[0]?.source ?? (hasYtApiKey ? 'YouTube API' : 'YouTube RSS'),
      asOf: new Date(nowMs).toISOString(),
    });
  });

  router.post('/mark-seen', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const body = markSeenSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid mark-seen payload', body.error.flatten());
    }

    const now = new Date().toISOString();
    let marked = 0;

    if (body.data.itemIds && body.data.itemIds.length > 0) {
      for (const itemId of body.data.itemIds) {
        const res = await c.env.DB.prepare(
          `INSERT OR IGNORE INTO item_seen (workspace_id, user_id, item_id, seen_at)
           SELECT f.workspace_id, ?, i.id, ?
           FROM items i
           JOIN follows f ON f.account_id = i.account_id
           WHERE f.workspace_id = ? AND i.id = ?`,
        )
          .bind(principal.userId, now, principal.workspaceId, itemId)
          .run();
        marked += res.meta?.changes ?? 0;
      }
    } else if (body.data.accountId) {
      const res = await c.env.DB.prepare(
        `INSERT OR IGNORE INTO item_seen (workspace_id, user_id, item_id, seen_at)
         SELECT f.workspace_id, ?, i.id, ?
         FROM items i
         JOIN follows f ON f.account_id = i.account_id
         WHERE f.workspace_id = ? AND i.account_id = ?`,
      )
        .bind(principal.userId, now, principal.workspaceId, body.data.accountId)
        .run();
      marked = res.meta?.changes ?? 0;
    } else if (body.data.all) {
      const res = await c.env.DB.prepare(
        `INSERT OR IGNORE INTO item_seen (workspace_id, user_id, item_id, seen_at)
         SELECT f.workspace_id, ?, i.id, ?
         FROM items i
         JOIN follows f ON f.account_id = i.account_id
         WHERE f.workspace_id = ? AND f.archived = 0`,
      )
        .bind(principal.userId, now, principal.workspaceId)
        .run();
      marked = res.meta?.changes ?? 0;
    }

    return c.json({ ok: true, marked });
  });

  router.get('/:itemId/detail', async (c) => {
    const principal = c.get('principal');
    const itemId = c.req.param('itemId');
    const nowMs = Date.now();
    const hasYtApiKey = Boolean(c.env.YOUTUBE_API_KEY);

    const row = await c.env.DB.prepare(
      `SELECT i.id, i.account_id, a.handle AS account_handle, a.display_name AS account_display_name,
              i.platform, i.external_id, i.kind, i.shorts_classification, i.title, i.url, i.thumbnail_url,
              i.published_at, i.first_seen_at, i.is_backfill, i.duration_sec,
              EXISTS(SELECT 1 FROM item_seen ise WHERE ise.workspace_id = ? AND ise.user_id = ? AND ise.item_id = i.id) AS is_seen,
              (SELECT s.views FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_views,
              (SELECT s.likes FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_likes,
              (SELECT s.comments FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_comments,
              (SELECT COUNT(*) FROM item_stats s WHERE s.item_id = i.id) AS snapshot_count,
              NULL AS rising_score, NULL AS rising_tier, NULL AS rising_reason,
              NULL AS claim_id, NULL AS claim_status, NULL AS claim_user_id
       FROM items i
       JOIN platform_accounts a ON a.id = i.account_id
       JOIN follows f ON f.account_id = a.id
       WHERE f.workspace_id = ? AND i.id = ?`,
    )
      .bind(principal.workspaceId, principal.userId, principal.workspaceId, itemId)
      .first<FeedRow>();

    if (!row) {
      throw AppError.notFound('Item not found');
    }

    const [snapsRes, claimsRes, alertsRes, membersRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT captured_at, views, likes, comments
         FROM item_stats WHERE item_id = ? ORDER BY captured_at ASC LIMIT 48`,
      )
        .bind(itemId)
        .all<{
          captured_at: string;
          views: number;
          likes: number | null;
          comments: number | null;
        }>(),
      c.env.DB.prepare(
        `SELECT id, workspace_id, item_id, user_id, start_sec, end_sec, status, note, clip_url, created_at, updated_at
         FROM claims WHERE workspace_id = ? AND item_id = ? ORDER BY created_at DESC`,
      )
        .bind(principal.workspaceId, itemId)
        .all<{
          id: string;
          workspace_id: string;
          item_id: string;
          user_id: string;
          start_sec: number | null;
          end_sec: number | null;
          status: FeedItem['claimStatus'] & string;
          note: string | null;
          clip_url: string | null;
          created_at: string;
          updated_at: string;
        }>(),
      c.env.DB.prepare(
        `SELECT id, type, confidence, score, reason, created_at
         FROM alerts WHERE workspace_id = ? AND item_id = ? ORDER BY created_at DESC`,
      )
        .bind(principal.workspaceId, itemId)
        .all<{
          id: string;
          type: string;
          confidence: string;
          score: number;
          reason: string;
          created_at: string;
        }>(),
      c.env.DB.prepare('SELECT user_id, email FROM memberships WHERE workspace_id = ?')
        .bind(principal.workspaceId)
        .all<{ user_id: string; email: string }>(),
    ]);

    const emailByUserId = new Map(
      (membersRes.results ?? []).map((m) => [m.user_id, m.email]),
    );

    const detail: ItemDetail = {
      item: mapFeedRow(row, emailByUserId, principal.userId, nowMs, hasYtApiKey),
      snapshots: (snapsRes.results ?? []).map((s) => ({
        capturedAt: s.captured_at,
        views: s.views,
        likes: s.likes,
        comments: s.comments,
      })),
      claims: (claimsRes.results ?? []).map((cl) => ({
        id: cl.id,
        workspaceId: cl.workspace_id,
        itemId: cl.item_id,
        userId: cl.user_id,
        startSec: cl.start_sec,
        endSec: cl.end_sec,
        status: claimStatusSchema.parse(cl.status),
        note: cl.note,
        clipUrl: cl.clip_url,
        createdAt: cl.created_at,
        updatedAt: cl.updated_at,
      })),
      alerts: (alertsRes.results ?? []).map((al) => ({
        id: al.id,
        type: al.type,
        confidence: al.confidence,
        score: al.score,
        reason: al.reason,
        createdAt: al.created_at,
      })),
    };

    return c.json(detail);
  });

  return router;
}
