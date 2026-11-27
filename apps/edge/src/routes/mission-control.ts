import { Hono } from 'hono';
import {
  formatProviderSource,
  median,
  normalizeHandle,
  type LiveStream,
  type MissionControlData,
  type Platform,
  type RisingItem,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';

export function createMissionControlRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');
    const wsId = principal.workspaceId;
    const nowMs = Date.now();
    const since24h = new Date(nowMs - 24 * 3_600_000).toISOString();
    const since7d = new Date(nowMs - 7 * 86_400_000).toISOString();
    const todayPrefix = new Date(nowMs).toISOString().slice(0, 10);
    const hasYtApiKey = Boolean(c.env.YOUTUBE_API_KEY);

    const [
      countsRow,
      newItemsRows,
      liveRows,
      unclaimedAlertsRows,
      staleClaimsRows,
      claimsActiveRow,
      clipsTodayRow,
      latenciesRows,
      risingRows,
      activityRows,
      ingestRow,
    ] = await Promise.all([
      c.env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM follows WHERE workspace_id = ? AND archived = 0) AS src_cnt,
           (SELECT COUNT(*) FROM items i JOIN follows f ON f.account_id = i.account_id WHERE f.workspace_id = ? AND f.archived = 0) AS item_cnt`,
      )
        .bind(wsId, wsId)
        .first<{ src_cnt: number; item_cnt: number }>(),
      c.env.DB.prepare(
        `SELECT i.kind, i.shorts_classification
         FROM items i
         JOIN follows f ON f.account_id = i.account_id
         WHERE f.workspace_id = ? AND f.archived = 0 AND i.published_at >= ?`,
      )
        .bind(wsId, since24h)
        .all<{ kind: string; shorts_classification: string | null }>(),
      c.env.DB.prepare(
        `SELECT i.id AS item_id, i.account_id, a.handle AS account_handle, a.display_name AS account_display_name,
                i.platform, i.external_id, i.title, i.url, i.thumbnail_url,
                ls.viewers, i.published_at AS started_at, ls.sampled_at
         FROM live_samples ls
         JOIN items i ON i.id = ls.item_id
         JOIN platform_accounts a ON a.id = i.account_id
         JOIN follows f ON f.account_id = a.id
         WHERE f.workspace_id = ? AND f.archived = 0 AND f.paused = 0 AND ls.is_live = 1
           AND ls.sampled_at = (SELECT MAX(ls2.sampled_at) FROM live_samples ls2 WHERE ls2.item_id = ls.item_id)
         ORDER BY ls.viewers DESC LIMIT 10`,
      )
        .bind(wsId)
        .all<{
          item_id: string;
          account_id: string;
          account_handle: string;
          account_display_name: string;
          platform: Platform;
          external_id: string;
          title: string;
          url: string;
          thumbnail_url: string | null;
          viewers: number;
          started_at: string;
          sampled_at: string;
        }>(),
      c.env.DB.prepare(
        `SELECT al.id AS alert_id, al.item_id, i.title, a.display_name AS creator_name,
                i.platform, al.reason, al.score, al.created_at
         FROM alerts al
         JOIN items i ON i.id = al.item_id
         JOIN platform_accounts a ON a.id = i.account_id
         WHERE al.workspace_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM claims cl
             WHERE cl.workspace_id = al.workspace_id AND cl.item_id = al.item_id
               AND cl.status IN ('New', 'Claimed', 'Clipping', 'Clipped', 'Published')
           )
         ORDER BY al.score DESC, al.created_at DESC LIMIT 10`,
      )
        .bind(wsId)
        .all<{
          alert_id: string;
          item_id: string;
          title: string;
          creator_name: string;
          platform: Platform;
          reason: string;
          score: number;
          created_at: string;
        }>(),
      c.env.DB.prepare(
        `SELECT cl.id AS claim_id, cl.item_id, i.title, a.display_name AS creator_name,
                i.platform, cl.status, cl.updated_at
         FROM claims cl
         JOIN items i ON i.id = cl.item_id
         JOIN platform_accounts a ON a.id = i.account_id
         WHERE cl.workspace_id = ? AND cl.status IN ('Claimed', 'Clipping') AND cl.updated_at < ?
         ORDER BY cl.updated_at ASC LIMIT 5`,
      )
        .bind(wsId, since24h)
        .all<{
          claim_id: string;
          item_id: string;
          title: string;
          creator_name: string;
          platform: Platform;
          status: string;
          updated_at: string;
        }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM claims WHERE workspace_id = ? AND status IN ('Claimed', 'Clipping')`,
      )
        .bind(wsId)
        .first<{ cnt: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS cnt FROM clips WHERE workspace_id = ? AND created_at >= ?`,
      )
        .bind(wsId, `${todayPrefix}T00:00:00Z`)
        .first<{ cnt: number }>(),
      c.env.DB.prepare(
        `SELECT (julianday(i.first_seen_at) - julianday(i.published_at)) * 86400000.0 AS lat_ms
         FROM alerts al
         JOIN items i ON i.id = al.item_id
         WHERE al.workspace_id = ? AND i.is_backfill = 0 AND al.created_at >= ?`,
      )
        .bind(wsId, since7d)
        .all<{ lat_ms: number }>(),
      c.env.DB.prepare(
        `SELECT al.item_id, i.account_id, a.handle AS account_handle, a.display_name AS account_display_name,
                i.platform, i.external_id, i.kind, i.title, i.url, i.thumbnail_url, i.published_at,
                i.is_backfill, al.type, al.score, al.reason, al.evidence_json, al.created_at
         FROM alerts al
         JOIN items i ON i.id = al.item_id
         JOIN platform_accounts a ON a.id = i.account_id
         WHERE al.workspace_id = ? AND al.type IN ('rising', 'breakout', 'viral') AND i.is_backfill = 0
         ORDER BY al.score DESC, al.created_at DESC LIMIT 5`,
      )
        .bind(wsId)
        .all<{
          item_id: string;
          account_id: string;
          account_handle: string;
          account_display_name: string;
          platform: Platform;
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
        }>(),
      c.env.DB.prepare(
        `SELECT au.id, m.email AS actor_email, au.action, au.target_type, au.target_id, au.created_at
         FROM audit_logs au
         LEFT JOIN memberships m ON m.workspace_id = au.workspace_id AND m.user_id = au.actor_user_id
         WHERE au.workspace_id = ?
         ORDER BY au.created_at DESC LIMIT 10`,
      )
        .bind(wsId)
        .all<{
          id: string;
          actor_email: string | null;
          action: string;
          target_type: string;
          target_id: string;
          created_at: string;
        }>(),
      c.env.DB.prepare('SELECT MAX(first_seen_at) AS last_ingest_at FROM items').first<{
        last_ingest_at: string | null;
      }>(),
    ]);

    const items24h = newItemsRows.results ?? [];
    let videos24h = 0;
    let shorts24h = 0;
    let live24h = 0;
    for (const row of items24h) {
      const cls = row.shorts_classification ?? row.kind;
      if (cls === 'short') shorts24h += 1;
      else if (cls === 'live') live24h += 1;
      else videos24h += 1;
    }

    const liveNowRail: LiveStream[] = (liveRows.results ?? []).map((r) => ({
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
      ageSeconds: Math.max(0, Math.floor((nowMs - Date.parse(r.sampled_at)) / 1000)),
    }));

    const unclaimed = unclaimedAlertsRows.results ?? [];
    const stale = staleClaimsRows.results ?? [];
    const needsAttention: MissionControlData['needsAttention'] = [
      ...unclaimed.slice(0, 6).map((a) => ({
        kind: 'unclaimed_alert' as const,
        alertId: a.alert_id,
        claimId: null,
        itemId: a.item_id,
        title: a.title,
        creatorName: a.creator_name,
        platform: a.platform,
        reason: a.reason,
        score: a.score,
        ageSeconds: Math.max(0, Math.floor((nowMs - Date.parse(a.created_at)) / 1000)),
      })),
      ...stale.map((s) => ({
        kind: 'stale_claim' as const,
        alertId: null,
        claimId: s.claim_id,
        itemId: s.item_id,
        title: s.title,
        creatorName: s.creator_name,
        platform: s.platform,
        reason: `${s.status} for >24h`,
        score: null,
        ageSeconds: Math.max(0, Math.floor((nowMs - Date.parse(s.updated_at)) / 1000)),
      })),
    ];

    const latencies = (latenciesRows.results ?? [])
      .map((l) => Math.max(0, Math.round(l.lat_ms)))
      .filter((n) => Number.isFinite(n));

    const risingTop5: RisingItem[] = (risingRows.results ?? []).map((r) => {
      let vel = 0;
      let eng: number | null = null;
      try {
        const ev = JSON.parse(r.evidence_json) as {
          velocityRatio?: number;
          engagementRatio?: number | null;
        };
        vel = typeof ev.velocityRatio === 'number' ? ev.velocityRatio : 0;
        eng = typeof ev.engagementRatio === 'number' ? ev.engagementRatio : null;
      } catch {
        // default
      }
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
        velocityRatio: vel,
        engagementRatio: eng,
        reason: r.reason,
        snapshotCount: 0,
        claim: null,
        source: formatProviderSource(r.platform, hasYtApiKey),
        ageSeconds: Math.max(0, Math.floor((nowMs - Date.parse(r.created_at)) / 1000)),
      };
    });

    const data: MissionControlData = {
      hasSources: (countsRow?.src_cnt ?? 0) > 0,
      hasItems: (countsRow?.item_cnt ?? 0) > 0,
      kpis: {
        newItems24h: {
          total: items24h.length,
          videos: videos24h,
          shorts: shorts24h,
          live: live24h,
        },
        liveNowCount: liveNowRail.length,
        hotUnclaimedCount: unclaimed.length,
        claimsInProgressCount: claimsActiveRow?.cnt ?? 0,
        clipsTodayCount: clipsTodayRow?.cnt ?? 0,
        medianTimeToAlertMs7d:
          latencies.length > 0 ? Math.round(median(latencies)) : null,
      },
      needsAttention,
      liveNowRail,
      risingTop5,
      teamActivity: (activityRows.results ?? []).map((a) => ({
        id: a.id,
        actorEmail: a.actor_email,
        action: a.action,
        targetType: a.target_type,
        targetId: a.target_id,
        summary: `${a.actor_email ?? 'member'} ${a.action} (${a.target_type})`,
        createdAt: a.created_at,
      })),
      providerHealth: {
        youtube: c.env.YOUTUBE_API_KEY
          ? { status: 'api_key_active', label: 'YouTube API' }
          : { status: 'public_feed_active', label: 'YouTube RSS' },
        twitch:
          c.env.TWITCH_CLIENT_ID && c.env.TWITCH_CLIENT_SECRET
            ? { status: 'ready', label: 'Twitch Helix' }
            : { status: 'credentials_missing', label: 'Twitch Needs API Keys' },
        kick:
          c.env.KICK_CLIENT_ID && c.env.KICK_CLIENT_SECRET
            ? { status: 'ready', label: 'Kick API' }
            : { status: 'credentials_missing', label: 'Kick Needs API Keys' },
        lastIngestAt: ingestRow?.last_ingest_at ?? null,
      },
      asOf: new Date(nowMs).toISOString(),
    };

    return c.json(data);
  });

  return router;
}
