import { Hono } from 'hono';
import { AppError, risingQuerySchema, type RisingItem } from '@clipse/core';
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
  type: 'rising' | 'breakout' | 'viral';
  score: number;
  reason: string;
  evidence_json: string;
  created_at: string;
}

function parseEvidence(raw: string): { velocityRatio: number; engagementRatio: number } {
  try {
    const parsed = JSON.parse(raw) as { velocityRatio?: unknown; engagementRatio?: unknown };
    return {
      velocityRatio: typeof parsed.velocityRatio === 'number' ? parsed.velocityRatio : 0,
      engagementRatio: typeof parsed.engagementRatio === 'number' ? parsed.engagementRatio : 0,
    };
  } catch {
    return { velocityRatio: 0, engagementRatio: 0 };
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
    ];
    const params: unknown[] = [principal.workspaceId, principal.workspaceId];

    if (tier) {
      conditions.push('al.type = ?');
      params.push(tier);
    }
    if (platform) {
      conditions.push('i.platform = ?');
      params.push(platform);
    }
    params.push(limit);

    const result = await c.env.DB.prepare(
      `SELECT al.item_id, i.account_id, a.handle AS account_handle, a.display_name AS account_display_name,
              i.platform, i.external_id, i.kind, i.title, i.url, i.thumbnail_url, i.published_at,
              al.type, al.score, al.reason, al.evidence_json, al.created_at
       FROM alerts al
       JOIN items i ON i.id = al.item_id
       JOIN platform_accounts a ON a.id = i.account_id
       JOIN follows f ON f.account_id = a.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY al.score DESC, al.created_at DESC
       LIMIT ?`,
    )
      .bind(...params)
      .all<RisingRow>();

    const nowMs = Date.now();
    const items: RisingItem[] = (result.results ?? []).map((r) => {
      const ev = parseEvidence(r.evidence_json);
      const createdMs = Date.parse(r.created_at);
      return {
        itemId: r.item_id,
        accountId: r.account_id,
        accountHandle: r.account_handle,
        accountDisplayName: r.account_display_name,
        platform: r.platform,
        externalId: r.external_id,
        kind: r.kind,
        title: r.title,
        url: r.url,
        thumbnailUrl: r.thumbnail_url,
        publishedAt: r.published_at,
        tier: r.type,
        score: r.score,
        velocityRatio: ev.velocityRatio,
        engagementRatio: ev.engagementRatio,
        reason: r.reason,
        source: 'd1',
        ageSeconds: Number.isFinite(createdMs)
          ? Math.max(0, Math.floor((nowMs - createdMs) / 1000))
          : 0,
      };
    });

    return c.json({
      items,
      source: 'd1',
      asOf: new Date(nowMs).toISOString(),
    });
  });

  return router;
}
