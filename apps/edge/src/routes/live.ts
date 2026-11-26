import { Hono } from 'hono';
import {
  formatProviderSource,
  normalizeHandle,
  type LiveStream,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';

interface LiveRow {
  item_id: string;
  account_id: string;
  account_handle: string;
  account_display_name: string;
  platform: 'youtube' | 'twitch' | 'kick';
  external_id: string;
  title: string;
  url: string;
  thumbnail_url: string | null;
  viewers: number;
  started_at: string;
  sampled_at: string;
}

export function createLiveRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');

    const result = await c.env.DB.prepare(
      `SELECT i.id AS item_id, i.account_id, a.handle AS account_handle, a.display_name AS account_display_name,
              i.platform, i.external_id, i.title, i.url, i.thumbnail_url,
              ls.viewers, i.published_at AS started_at, ls.sampled_at
       FROM live_samples ls
       JOIN items i ON i.id = ls.item_id
       JOIN platform_accounts a ON a.id = i.account_id
       JOIN follows f ON f.account_id = a.id
       WHERE f.workspace_id = ?
         AND f.archived = 0
         AND f.paused = 0
         AND ls.is_live = 1
         AND ls.sampled_at = (
           SELECT MAX(ls2.sampled_at) FROM live_samples ls2 WHERE ls2.item_id = ls.item_id
         )
       ORDER BY ls.viewers DESC, ls.sampled_at DESC`,
    )
      .bind(principal.workspaceId)
      .all<LiveRow>();

    const nowMs = Date.now();
    const hasYtApiKey = Boolean(c.env.YOUTUBE_API_KEY);
    const streams: LiveStream[] = (result.results ?? []).map((r) => {
      const sampledMs = Date.parse(r.sampled_at);
      return {
        itemId: r.item_id,
        accountId: r.account_id,
        accountHandle: normalizeHandle(r.account_handle),
        accountDisplayName: r.account_display_name,
        platform: r.platform,
        externalId: r.external_id,
        title: r.title,
        url: r.url,
        thumbnailUrl: r.thumbnail_url,
        viewers: r.viewers,
        startedAt: r.started_at,
        sampledAt: r.sampled_at,
        source: formatProviderSource(r.platform, hasYtApiKey),
        ageSeconds: Number.isFinite(sampledMs)
          ? Math.max(0, Math.floor((nowMs - sampledMs) / 1000))
          : 0,
      };
    });

    const responseSource =
      streams[0]?.source ?? (hasYtApiKey ? 'YouTube API' : 'YouTube RSS');

    return c.json({
      streams,
      liveCount: streams.length,
      source: responseSource,
      asOf: new Date(nowMs).toISOString(),
    });
  });

  return router;
}
