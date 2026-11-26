import { Hono } from 'hono';
import {
  AppError,
  claimStatusSchema,
  formatProviderSource,
  normalizeHandle,
  risingQuerySchema,
  type ItemClaimInfo,
  type RisingItem,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';

interface RisingRow {
  item_id: string;
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
  is_backfill: number;
  type: 'rising' | 'breakout' | 'viral';
  score: number;
  reason: string;
  evidence_json: string;
  created_at: string;
  claim_id: string | null;
  claim_status: string | null;
  claim_user_id: string | null;
}

function parseEvidence(raw: string): {
  velocityRatio: number;
  engagementRatio: number | null;
} {
  try {
    const parsed = JSON.parse(raw) as {
      velocityRatio?: unknown;
      engagementRatio?: unknown;
    };
    return {
      velocityRatio:
        typeof parsed.velocityRatio === 'number' ? parsed.velocityRatio : 0,
      engagementRatio:
        typeof parsed.engagementRatio === 'number' ? parsed.engagementRatio : null,
    };
  } catch {
    return { velocityRatio: 0, engagementRatio: null };
  }
}

export function createRisingRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');
    const query = risingQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      throw AppError.badRequest('Invalid rising query', query.error.flatten());
    }

    const { tier, platform, limit } = query.data;
    const conditions: string[] = [
      'al.workspace_id = ?',
      "al.type IN ('rising', 'breakout', 'viral')",
      'f.workspace_id = ?',
      'f.archived = 0',
      'f.paused = 0',
      'i.is_backfill = 0',
    ];
    const params: unknown[] = [
      principal.workspaceId,
      principal.workspaceId,
      principal.workspaceId,
      principal.workspaceId,
      principal.workspaceId,
    ];

    if (tier) {
      conditions.push('al.type = ?');
      params.push(tier);
    }
    if (platform) {
      conditions.push('i.platform = ?');
      params.push(platform);
    }
    params.push(limit);

    const [result, membersRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT al.item_id, i.account_id, a.handle AS account_handle, a.display_name AS account_display_name,
                i.platform, i.external_id, i.kind, i.title, i.url, i.thumbnail_url, i.published_at,
                i.is_backfill, al.type, al.score, al.reason, al.evidence_json, al.created_at,
                (SELECT cl.id FROM claims cl WHERE cl.workspace_id = ? AND cl.item_id = i.id AND cl.status IN ('New', 'Claimed', 'Clipped') ORDER BY cl.updated_at DESC LIMIT 1) AS claim_id,
                (SELECT cl.status FROM claims cl WHERE cl.workspace_id = ? AND cl.item_id = i.id AND cl.status IN ('New', 'Claimed', 'Clipped') ORDER BY cl.updated_at DESC LIMIT 1) AS claim_status,
                (SELECT cl.user_id FROM claims cl WHERE cl.workspace_id = ? AND cl.item_id = i.id AND cl.status IN ('New', 'Claimed', 'Clipped') ORDER BY cl.updated_at DESC LIMIT 1) AS claim_user_id
         FROM alerts al
         JOIN items i ON i.id = al.item_id
         JOIN platform_accounts a ON a.id = i.account_id
         JOIN follows f ON f.account_id = a.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY al.score DESC, al.created_at DESC
         LIMIT ?`,
      )
        .bind(...params)
        .all<RisingRow>(),
      c.env.DB.prepare('SELECT user_id, email FROM memberships WHERE workspace_id = ?')
        .bind(principal.workspaceId)
        .all<{ user_id: string; email: string }>(),
    ]);

    const emailByUserId = new Map(
      (membersRes.results ?? []).map((m) => [m.user_id, m.email]),
    );

    const rows = result.results ?? [];
    const snapshotsByItem = new Map<string, number[]>();
    for (const r of rows) {
      const snaps = await c.env.DB.prepare(
        'SELECT views FROM item_stats WHERE item_id = ? ORDER BY captured_at ASC LIMIT 24',
      )
        .bind(r.item_id)
        .all<{ views: number }>();
      snapshotsByItem.set(
        r.item_id,
        (snaps.results ?? []).map((s) => s.views),
      );
    }

    const nowMs = Date.now();
    const hasYtApiKey = Boolean(c.env.YOUTUBE_API_KEY);
    const items: RisingItem[] = rows.map((r) => {
      const ev = parseEvidence(r.evidence_json);
      const createdMs = Date.parse(r.created_at);
      const snaps = snapshotsByItem.get(r.item_id) ?? [];
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
        itemId: r.item_id,
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
        isBackfill: r.is_backfill === 1,
        tier: r.type,
        score: r.score,
        velocityRatio: ev.velocityRatio,
        engagementRatio: ev.engagementRatio,
        reason: r.reason,
        snapshotCount: snaps.length,
        snapshots: snaps.length >= 3 ? snaps : undefined,
        claim,
        source: formatProviderSource(r.platform, hasYtApiKey),
        ageSeconds: Number.isFinite(createdMs)
          ? Math.max(0, Math.floor((nowMs - createdMs) / 1000))
          : 0,
      };
    });

    const responseSource =
      items[0]?.source ?? (hasYtApiKey ? 'YouTube API' : 'YouTube RSS');

    return c.json({
      items,
      source: responseSource,
      asOf: new Date(nowMs).toISOString(),
    });
  });

  return router;
}
