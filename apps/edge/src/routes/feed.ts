import { Hono } from 'hono';
import {
  AppError,
  claimStatusSchema,
  feedQuerySchema,
  formatProviderSource,
  normalizeHandle,
  type FeedItem,
  type ItemClaimInfo,
} from '@clipse/core';
import { z } from 'zod';
import type { EdgeBindings, EdgeVariables } from '../app.js';

const cursorPayloadSchema = z.object({
  p: z.string().min(1),
  id: z.string().min(1),
});

interface FeedRow {
  id: string;
  account_id: string;
  account_handle: string;
  account_display_name: string;
  platform: 'youtube' | 'twitch' | 'kick';
  external_id: string;
  kind: 'video' | 'short' | 'live' | 'vod' | 'clip';
  title: string;
  url: string;
  thumbnail_url: string | null;
  published_at: string;
  first_seen_at: string;
  is_backfill: number;
  duration_sec: number | null;
  latest_views: number | null;
  latest_likes: number | null;
  latest_comments: number | null;
  snapshot_count: number;
  claim_id: string | null;
  claim_status: string | null;
  claim_user_id: string | null;
  claim_user_email: string | null;
}

function encodeCursor(publishedAt: string, id: string): string {
  return btoa(JSON.stringify({ p: publishedAt, id }));
}

function decodeCursor(raw: string): { p: string; id: string } {
  try {
    return cursorPayloadSchema.parse(JSON.parse(atob(raw)));
  } catch {
    throw AppError.badRequest('Invalid pagination cursor');
  }
}

export function createFeedRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');
    const query = feedQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      throw AppError.badRequest('Invalid feed query', query.error.flatten());
    }

    const { cursor, limit, platform, kind, accountId, starredOnly, q } = query.data;
    const cursorVal = cursor ? decodeCursor(cursor) : null;

    const conditions: string[] = [
      'f.workspace_id = ?',
      'f.archived = 0',
      'f.paused = 0',
    ];
    const params: unknown[] = [
      principal.workspaceId,
      principal.workspaceId,
      principal.workspaceId,
      principal.workspaceId,
    ];

    if (platform) {
      conditions.push('i.platform = ?');
      params.push(platform);
    }
    if (kind) {
      conditions.push('i.kind = ?');
      params.push(kind);
    }
    if (accountId) {
      conditions.push('i.account_id = ?');
      params.push(accountId);
    }
    if (starredOnly) {
      conditions.push('f.starred = 1');
    }
    if (q) {
      conditions.push('LOWER(i.title) LIKE ?');
      params.push(`%${q.toLowerCase()}%`);
    }
    if (cursorVal) {
      conditions.push('(i.published_at < ? OR (i.published_at = ? AND i.id < ?))');
      params.push(cursorVal.p, cursorVal.p, cursorVal.id);
    }

    params.push(limit + 1);

    const sql = `
      SELECT i.id, i.account_id, a.handle AS account_handle, a.display_name AS account_display_name,
             i.platform, i.external_id, i.kind, i.title, i.url, i.thumbnail_url,
             i.published_at, i.first_seen_at, i.is_backfill, i.duration_sec,
             (SELECT s.views FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_views,
             (SELECT s.likes FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_likes,
             (SELECT s.comments FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_comments,
             (SELECT COUNT(*) FROM item_stats s WHERE s.item_id = i.id) AS snapshot_count,
             (SELECT cl.id FROM claims cl WHERE cl.workspace_id = ? AND cl.item_id = i.id AND cl.status IN ('New', 'Claimed', 'Clipped') ORDER BY cl.updated_at DESC LIMIT 1) AS claim_id,
             (SELECT cl.status FROM claims cl WHERE cl.workspace_id = ? AND cl.item_id = i.id AND cl.status IN ('New', 'Claimed', 'Clipped') ORDER BY cl.updated_at DESC LIMIT 1) AS claim_status,
             (SELECT cl.user_id FROM claims cl WHERE cl.workspace_id = ? AND cl.item_id = i.id AND cl.status IN ('New', 'Claimed', 'Clipped') ORDER BY cl.updated_at DESC LIMIT 1) AS claim_user_id,
             NULL AS claim_user_email
      FROM items i
      JOIN platform_accounts a ON a.id = i.account_id
      JOIN follows f ON f.account_id = a.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY i.published_at DESC, i.id DESC
      LIMIT ?
    `;

    const [result, membersRes] = await Promise.all([
      c.env.DB.prepare(sql).bind(...params).all<FeedRow>(),
      c.env.DB.prepare('SELECT user_id, email FROM memberships WHERE workspace_id = ?')
        .bind(principal.workspaceId)
        .all<{ user_id: string; email: string }>(),
    ]);

    const emailByUserId = new Map(
      (membersRes.results ?? []).map((m) => [m.user_id, m.email]),
    );

    const rows = result.results ?? [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nowMs = Date.now();
    const hasYtApiKey = Boolean(c.env.YOUTUBE_API_KEY);

    const items: FeedItem[] = pageRows.map((r) => {
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
      const claim: ItemClaimInfo | null =
        r.claim_id && parsedClaim?.success && r.claim_user_id
          ? {
              id: r.claim_id,
              status: parsedClaim.data,
              userId: r.claim_user_id,
              email: emailByUserId.get(r.claim_user_id) ?? null,
              claimedByMe: r.claim_user_id === principal.userId,
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
        title: r.title,
        url: r.url,
        thumbnailUrl: r.thumbnail_url,
        publishedAt: r.published_at,
        firstSeenAt: r.first_seen_at,
        isBackfill: r.is_backfill === 1,
        durationSec: r.duration_sec,
        ingestLatencyMs: latency,
        latestViews: r.latest_views,
        latestLikes: r.latest_likes,
        latestComments: r.latest_comments,
        snapshotCount: r.snapshot_count ?? 0,
        claimStatus: parsedClaim?.success ? parsedClaim.data : null,
        claim,
        source: formatProviderSource(r.platform, hasYtApiKey),
        ageSeconds,
      };
    });

    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.published_at, last.id) : null;
    const responseSource = items[0]?.source ?? (hasYtApiKey ? 'YouTube API' : 'YouTube RSS');

    return c.json({
      items,
      nextCursor,
      source: responseSource,
      asOf: new Date(nowMs).toISOString(),
    });
  });

  return router;
}
