import { Hono } from 'hono';
import {
  AppError,
  formatProviderSource,
  median,
  normalizeHandle,
  sourceRuleSchema,
  updateCreatorNotesSchema,
  type CreatorBaseline,
  type CreatorHeatmapBucket,
  type CreatorLaneItem,
  type CreatorSummary,
  type Platform,
  type SourceRule,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { requireWriterRole } from '../auth.js';

const BASELINE_FLOOR = 5;
const ROI_FLOOR = 3;

interface FollowCreatorRow {
  follow_id: string;
  account_id: string;
  platform: Platform;
  external_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  starred: number;
  is_own: number;
  paused: number;
  archived: number;
  group_name: string | null;
  tags_json: string;
  rules_json: string;
  last_synced_at: string | null;
}

interface CreatorItemRow {
  id: string;
  account_id: string;
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
  duration_sec: number | null;
  latest_views: number | null;
  latest_likes: number | null;
  latest_comments: number | null;
  rising_score: number | null;
  rising_tier: string | null;
  rising_reason: string | null;
  claim_status: string | null;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseRules(raw: string): SourceRule {
  try {
    return sourceRuleSchema.parse(JSON.parse(raw));
  } catch {
    return sourceRuleSchema.parse({});
  }
}

function resolveLane(
  item: Pick<CreatorItemRow, 'kind' | 'shorts_classification'>,
): 'videos' | 'shorts' | 'live' | 'unclassified' {
  if (item.shorts_classification === 'unclassified') return 'unclassified';
  if (item.shorts_classification === 'short') return 'shorts';
  if (item.shorts_classification === 'live') return 'live';
  if (item.shorts_classification === 'video') return 'videos';
  if (item.kind === 'short' || item.kind === 'clip') return 'shorts';
  if (item.kind === 'live') return 'live';
  return 'videos';
}

function computeBaselines(
  items: readonly CreatorItemRow[],
  sevenDaysAgoIso: string,
): CreatorBaseline[] {
  const byKind = new Map<CreatorItemRow['kind'], number[]>();
  for (const item of items) {
    if (item.published_at <= sevenDaysAgoIso && item.latest_views !== null) {
      const list = byKind.get(item.kind) ?? [];
      list.push(item.latest_views);
      byKind.set(item.kind, list);
    }
  }
  const out: CreatorBaseline[] = [];
  for (const [kind, vals] of byKind.entries()) {
    const ready = vals.length >= BASELINE_FLOOR;
    out.push({
      kind,
      medianViews: ready ? Math.round(median(vals)) : null,
      sampleSize: vals.length,
      requiredSamples: BASELINE_FLOOR,
      status: ready ? 'ready' : 'collecting',
    });
  }
  return out;
}

async function buildCreatorSummary(
  db: D1Database,
  workspaceId: string,
  row: FollowCreatorRow,
  sevenDaysAgoIso: string,
): Promise<{ summary: CreatorSummary; items: CreatorItemRow[]; noteBody: string; noteUpdatedAt: string | null; noteEmail: string | null }> {
  const [itemsRes, noteRow, subRow, claimsRows, clipsRows] = await Promise.all([
    db
      .prepare(
        `SELECT i.id, i.account_id, i.platform, i.external_id, i.kind, i.shorts_classification,
                i.title, i.url, i.thumbnail_url, i.published_at, i.first_seen_at, i.is_backfill,
                i.duration_sec,
                (SELECT s.views FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_views,
                (SELECT s.likes FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_likes,
                (SELECT s.comments FROM item_stats s WHERE s.item_id = i.id ORDER BY s.captured_at DESC LIMIT 1) AS latest_comments,
                (SELECT al.score FROM alerts al WHERE al.workspace_id = ? AND al.item_id = i.id AND al.type IN ('rising','breakout','viral') ORDER BY al.score DESC LIMIT 1) AS rising_score,
                (SELECT al.type FROM alerts al WHERE al.workspace_id = ? AND al.item_id = i.id AND al.type IN ('rising','breakout','viral') ORDER BY al.score DESC LIMIT 1) AS rising_tier,
                (SELECT al.reason FROM alerts al WHERE al.workspace_id = ? AND al.item_id = i.id AND al.type IN ('rising','breakout','viral') ORDER BY al.score DESC LIMIT 1) AS rising_reason,
                (SELECT cl.status FROM claims cl WHERE cl.workspace_id = ? AND cl.item_id = i.id ORDER BY cl.updated_at DESC LIMIT 1) AS claim_status
         FROM items i
         WHERE i.account_id = ?
         ORDER BY i.published_at DESC, i.id DESC
         LIMIT 200`,
      )
      .bind(workspaceId, workspaceId, workspaceId, workspaceId, row.account_id)
      .all<CreatorItemRow>(),
    db
      .prepare(
        `SELECT cn.body, cn.updated_at, m.email AS updated_by_email
         FROM creator_notes cn
         LEFT JOIN memberships m ON m.workspace_id = cn.workspace_id AND m.user_id = cn.user_id
         WHERE cn.workspace_id = ? AND cn.account_id = ?`,
      )
      .bind(workspaceId, row.account_id)
      .first<{ body: string; updated_at: string; updated_by_email: string | null }>(),
    db
      .prepare(
        `SELECT topic, status, lease_expires_at
         FROM webhook_subscriptions
         WHERE platform = ? AND account_external_id = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(row.platform, row.external_id)
      .first<{
        topic: string;
        status: 'pending' | 'active' | 'revoked' | 'expired';
        lease_expires_at: string | null;
      }>(),
    db
      .prepare(
        `SELECT cl.id, cl.status
         FROM claims cl
         JOIN items i ON i.id = cl.item_id
         WHERE cl.workspace_id = ? AND i.account_id = ?`,
      )
      .bind(workspaceId, row.account_id)
      .all<{ id: string; status: string }>(),
    db
      .prepare(
        `SELECT cp.id, cp.created_at, cp.manual_revenue_cents,
                (SELECT cs.views FROM clip_stats_snapshots cs WHERE cs.workspace_id = cp.workspace_id AND cs.clip_id = cp.id ORDER BY cs.captured_at DESC LIMIT 1) AS latest_views,
                (SELECT MIN(al.created_at) FROM alerts al WHERE al.workspace_id = cp.workspace_id AND al.item_id = i.id) AS first_alert_at
         FROM clips cp
         JOIN items i ON i.id = cp.source_item_id
         WHERE cp.workspace_id = ? AND i.account_id = ?`,
      )
      .bind(workspaceId, row.account_id)
      .all<{
        id: string;
        created_at: string;
        manual_revenue_cents: number | null;
        latest_views: number | null;
        first_alert_at: string | null;
      }>(),
  ]);

  const items = itemsRes.results ?? [];
  const laneCounts = { videos: 0, shorts: 0, live: 0, unclassified: 0 };
  for (const item of items) {
    laneCounts[resolveLane(item)] += 1;
  }

  const observedEvents = items.length;
  const cadenceSummary =
    observedEvents >= BASELINE_FLOOR
      ? `Based on ${observedEvents} observed events`
      : `Collecting activity (${observedEvents}/${BASELINE_FLOOR})`;

  const claims = claimsRows.results ?? [];
  const clips = clipsRows.results ?? [];
  const clippedCount = claims.filter(
    (cl) => cl.status === 'Clipped' || cl.status === 'Published',
  ).length;
  const clipViews = clips
    .map((cp) => cp.latest_views)
    .filter((v): v is number => v !== null && v >= 0);
  const timeDiffs = clips
    .map((cp) => {
      if (!cp.first_alert_at) return null;
      const diff = Date.parse(cp.created_at) - Date.parse(cp.first_alert_at);
      return Number.isFinite(diff) && diff >= 0 ? diff : null;
    })
    .filter((d): d is number => d !== null);
  const totalManualRevenueCents = clips.reduce(
    (sum, cp) => sum + (cp.manual_revenue_cents ?? 0),
    0,
  );

  const noteBody = noteRow?.body ?? '';
  const summary: CreatorSummary = {
    followId: row.follow_id,
    accountId: row.account_id,
    platform: row.platform,
    externalId: row.external_id,
    handle: normalizeHandle(row.handle),
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    starred: row.starred === 1,
    isOwn: row.is_own === 1,
    paused: row.paused === 1,
    archived: row.archived === 1,
    groupName: row.group_name,
    tags: parseTags(row.tags_json),
    rules: parseRules(row.rules_json),
    lastSyncedAt: row.last_synced_at,
    laneCounts,
    baselines: computeBaselines(items, sevenDaysAgoIso),
    observedEvents,
    cadenceSummary,
    notesPreview: noteBody ? noteBody.slice(0, 140) : null,
    subscriptionHealth: subRow
      ? {
          topic: subRow.topic,
          status: subRow.status,
          leaseExpiresAt: subRow.lease_expires_at,
        }
      : { topic: 'none', status: 'none', leaseExpiresAt: null },
    teamRoi: {
      claimsCount: claims.length,
      clipsCount: clips.length,
      hitRate:
        claims.length >= ROI_FLOOR
          ? Math.round((clippedCount / claims.length) * 1000) / 1000
          : null,
      medianClipViews: clipViews.length >= ROI_FLOOR ? Math.round(median(clipViews)) : null,
      medianTimeToClipMs:
        timeDiffs.length >= ROI_FLOOR ? Math.round(median(timeDiffs)) : null,
      totalManualRevenueCents,
      sampleFloor: ROI_FLOOR,
    },
  };

  return {
    summary,
    items,
    noteBody,
    noteUpdatedAt: noteRow?.updated_at ?? null,
    noteEmail: noteRow?.updated_by_email ?? null,
  };
}

function mapLaneItem(
  r: CreatorItemRow,
  nowMs: number,
  hasYtApiKey: boolean,
): CreatorLaneItem {
  const seenMs = Date.parse(r.first_seen_at);
  const ageSeconds = Number.isFinite(seenMs)
    ? Math.max(0, Math.floor((nowMs - seenMs) / 1000))
    : 0;
  const tier =
    r.rising_tier === 'rising' || r.rising_tier === 'breakout' || r.rising_tier === 'viral'
      ? r.rising_tier
      : null;

  return {
    id: r.id,
    accountId: r.account_id,
    accountHandle: '',
    accountDisplayName: '',
    platform: r.platform,
    externalId: r.external_id,
    kind: r.kind,
    shortsClassification: r.shorts_classification,
    title: r.title,
    url: r.url,
    thumbnailUrl: r.thumbnail_url,
    publishedAt: r.published_at,
    firstSeenAt: r.first_seen_at,
    isBackfill: r.is_backfill === 1,
    durationSec: r.duration_sec,
    latestViews: r.latest_views,
    latestLikes: r.latest_likes,
    latestComments: r.latest_comments,
    risingScore: r.rising_score,
    risingTier: tier,
    risingReason: r.rising_reason,
    claimStatus: r.claim_status,
    source: formatProviderSource(r.platform, hasYtApiKey),
    ageSeconds,
  };
}

export function createCreatorsRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');
    const nowMs = Date.now();
    const sevenDaysAgoIso = new Date(nowMs - 7 * 86_400_000).toISOString();

    const followsRes = await c.env.DB.prepare(
      `SELECT f.id AS follow_id, a.id AS account_id, a.platform, a.external_id, a.handle,
              a.display_name, a.avatar_url, f.starred, f.is_own, f.paused, f.archived,
              f.group_name, f.tags_json, f.rules_json, a.last_synced_at
       FROM follows f
       JOIN platform_accounts a ON a.id = f.account_id
       WHERE f.workspace_id = ? AND f.archived = 0
       ORDER BY f.starred DESC, a.display_name ASC`,
    )
      .bind(principal.workspaceId)
      .all<FollowCreatorRow>();

    const creators: CreatorSummary[] = [];
    for (const row of followsRes.results ?? []) {
      const built = await buildCreatorSummary(
        c.env.DB,
        principal.workspaceId,
        row,
        sevenDaysAgoIso,
      );
      creators.push(built.summary);
    }

    return c.json({
      creators,
      source: 'd1',
      asOf: new Date(nowMs).toISOString(),
    });
  });

  router.get('/:accountId', async (c) => {
    const principal = c.get('principal');
    const accountId = c.req.param('accountId');
    const nowMs = Date.now();
    const sevenDaysAgoIso = new Date(nowMs - 7 * 86_400_000).toISOString();
    const hasYtApiKey = Boolean(c.env.YOUTUBE_API_KEY);

    const row = await c.env.DB.prepare(
      `SELECT f.id AS follow_id, a.id AS account_id, a.platform, a.external_id, a.handle,
              a.display_name, a.avatar_url, f.starred, f.is_own, f.paused, f.archived,
              f.group_name, f.tags_json, f.rules_json, a.last_synced_at
       FROM follows f
       JOIN platform_accounts a ON a.id = f.account_id
       WHERE f.workspace_id = ? AND f.account_id = ? AND f.archived = 0`,
    )
      .bind(principal.workspaceId, accountId)
      .first<FollowCreatorRow>();

    if (!row) {
      throw AppError.notFound('Creator not found in workspace');
    }

    const built = await buildCreatorSummary(
      c.env.DB,
      principal.workspaceId,
      row,
      sevenDaysAgoIso,
    );

    const itemsByLane: {
      videos: CreatorLaneItem[];
      shorts: CreatorLaneItem[];
      live: CreatorLaneItem[];
      unclassified: CreatorLaneItem[];
    } = { videos: [], shorts: [], live: [], unclassified: [] };

    for (const item of built.items) {
      const lane = resolveLane(item);
      if (itemsByLane[lane].length < 25) {
        const mapped = mapLaneItem(item, nowMs, hasYtApiKey);
        itemsByLane[lane].push({
          ...mapped,
          accountHandle: built.summary.handle,
          accountDisplayName: built.summary.displayName,
        });
      }
    }

    const ready = built.summary.observedEvents >= BASELINE_FLOOR;
    const heatmapMap = new Map<string, CreatorHeatmapBucket>();
    let avgPerWeek: number | null = null;

    if (ready) {
      let minMs = Infinity;
      let maxMs = -Infinity;
      for (const item of built.items) {
        const d = new Date(item.published_at);
        const ms = d.getTime();
        if (Number.isNaN(ms)) continue;
        if (ms < minMs) minMs = ms;
        if (ms > maxMs) maxMs = ms;
        const dayOfWeek = d.getUTCDay();
        const hourUtc = d.getUTCHours();
        const key = `${dayOfWeek}:${hourUtc}`;
        const cur = heatmapMap.get(key);
        if (cur) {
          cur.count += 1;
        } else {
          heatmapMap.set(key, { dayOfWeek, hourUtc, count: 1 });
        }
      }
      const spanWeeks = Math.max(1, (maxMs - minMs) / (7 * 86_400_000));
      avgPerWeek = Math.round((built.items.length / spanWeeks) * 10) / 10;
    }

    return c.json({
      creator: built.summary,
      itemsByLane,
      cadence: {
        observedEvents: built.summary.observedEvents,
        sampleFloor: BASELINE_FLOOR,
        ready,
        summaryLabel: built.summary.cadenceSummary,
        avgPerWeek,
        heatmap: Array.from(heatmapMap.values()),
      },
      notes: {
        body: built.noteBody,
        updatedAt: built.noteUpdatedAt,
        updatedByEmail: built.noteEmail,
      },
      source: formatProviderSource(row.platform, hasYtApiKey),
      asOf: new Date(nowMs).toISOString(),
    });
  });

  router.put('/:accountId/notes', async (c) => {
    const principal = c.get('principal');
    requireWriterRole(principal);
    const accountId = c.req.param('accountId');

    const body = updateCreatorNotesSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid creator notes payload', body.error.flatten());
    }

    const follow = await c.env.DB.prepare(
      'SELECT id FROM follows WHERE workspace_id = ? AND account_id = ? AND archived = 0',
    )
      .bind(principal.workspaceId, accountId)
      .first<{ id: string }>();

    if (!follow) {
      throw AppError.notFound('Creator not found in workspace');
    }

    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO creator_notes (id, workspace_id, account_id, user_id, body, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, account_id) DO UPDATE SET
         user_id = excluded.user_id,
         body = excluded.body,
         updated_at = excluded.updated_at`,
    )
      .bind(
        crypto.randomUUID(),
        principal.workspaceId,
        accountId,
        principal.userId,
        body.data.body,
        now,
      )
      .run();

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'creator.notes_updated', 'creator', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        principal.workspaceId,
        principal.userId,
        accountId,
        JSON.stringify({ length: body.data.body.length }),
        now,
      )
      .run();

    return c.json({
      ok: true,
      accountId,
      body: body.data.body,
      updatedAt: now,
      updatedByEmail: principal.email,
    });
  });

  return router;
}
