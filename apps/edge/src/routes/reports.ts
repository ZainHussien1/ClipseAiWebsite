import { Hono } from 'hono';
import {
  AppError,
  formatDeterministicDailyNarrative,
  GeminiInsightsProvider,
  hasRoleAtLeast,
  type DailyReportData,
  type Platform,
  type ScorecardData,
  type SourceRoiEntry,
  type WeeklyReportData,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';

const ROI_SAMPLE_FLOOR = 3;
const SCORECARD_SAMPLE_FLOOR = 5;

function formatDateInTimezone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function enumerateLast7Days(endDateYmd: string): string[] {
  const parsed = new Date(`${endDateYmd}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    const out: string[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      out.push(new Date(fallback.getTime() - i * 86_400_000).toISOString().slice(0, 10));
    }
    return out;
  }
  const out: string[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    out.push(new Date(parsed.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export function createReportsRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/roi', async (c) => {
    const principal = c.get('principal');

    const rows = await c.env.DB.prepare(
      `SELECT a.id AS account_id, a.handle, a.display_name, a.platform,
              COUNT(DISTINCT cl.id) AS claims_count,
              COUNT(DISTINCT cp.id) AS clips_count,
              COALESCE(SUM(COALESCE(cs.views, 0)), 0) AS total_clip_views
       FROM follows f
       JOIN platform_accounts a ON a.id = f.account_id
       LEFT JOIN items i ON i.account_id = a.id
       LEFT JOIN claims cl ON cl.workspace_id = f.workspace_id AND cl.item_id = i.id
       LEFT JOIN clips cp ON cp.workspace_id = f.workspace_id AND (cp.source_item_id = i.id OR cp.claim_id = cl.id)
       LEFT JOIN clip_stats_snapshots cs ON cs.id = (
         SELECT cs2.id FROM clip_stats_snapshots cs2
         WHERE cs2.workspace_id = f.workspace_id AND cs2.clip_id = cp.id
         ORDER BY cs2.captured_at DESC LIMIT 1
       )
       WHERE f.workspace_id = ? AND f.archived = 0
       GROUP BY a.id
       ORDER BY clips_count DESC, claims_count DESC`,
    )
      .bind(principal.workspaceId)
      .all<{
        account_id: string;
        handle: string;
        display_name: string;
        platform: Platform;
        claims_count: number;
        clips_count: number;
        total_clip_views: number;
      }>();

    const entries: SourceRoiEntry[] = (rows.results ?? []).map((r) => {
      const sampleCount = Math.max(r.claims_count, r.clips_count);
      const ready = sampleCount >= ROI_SAMPLE_FLOOR && r.claims_count > 0;
      return {
        accountId: r.account_id,
        handle: r.handle,
        displayName: r.display_name,
        platform: r.platform,
        claimsCount: r.claims_count,
        clipsCount: r.clips_count,
        totalClipViews: r.total_clip_views,
        sampleFloor: ROI_SAMPLE_FLOOR,
        status: ready ? 'ready' : 'not enough data yet',
        clipsPerClaim: ready
          ? Math.round((r.clips_count / r.claims_count) * 100) / 100
          : null,
      };
    });

    return c.json({
      roi: entries,
      source: 'd1',
      asOf: new Date().toISOString(),
    });
  });

  router.get('/admin/scorecard', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('Scorecard requires Admin or Owner role');
    }

    const [risingVotes, liveVotes, alertClaims, latencyRow, ingestRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN av.useful = 1 THEN 1 ELSE 0 END), 0) AS useful_count
         FROM alert_votes av
         JOIN alerts al ON al.id = av.alert_id
         WHERE av.workspace_id = ? AND al.type IN ('rising', 'breakout', 'viral')`,
      )
        .bind(principal.workspaceId)
        .first<{ total: number; useful_count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN av.useful = 1 THEN 1 ELSE 0 END), 0) AS useful_count
         FROM alert_votes av
         JOIN alerts al ON al.id = av.alert_id
         WHERE av.workspace_id = ? AND al.type = 'live_moment'`,
      )
        .bind(principal.workspaceId)
        .first<{ total: number; useful_count: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT al.id) AS total_alerts,
                COUNT(DISTINCT cl.item_id) AS claimed_items
         FROM alerts al
         LEFT JOIN claims cl ON cl.workspace_id = al.workspace_id AND cl.item_id = al.item_id
         WHERE al.workspace_id = ?`,
      )
        .bind(principal.workspaceId)
        .first<{ total_alerts: number; claimed_items: number }>(),
      c.env.DB.prepare(
        `SELECT AVG((julianday(i.first_seen_at) - julianday(i.published_at)) * 86400000.0) AS avg_ms
         FROM alerts al
         JOIN items i ON i.id = al.item_id
         WHERE al.workspace_id = ? AND i.is_backfill = 0`,
      )
        .bind(principal.workspaceId)
        .first<{ avg_ms: number | null }>(),
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(pushes_received), 0) AS pushes,
                COALESCE(SUM(missed_pushes), 0) AS missed,
                COALESCE(SUM(reconcile_runs), 0) AS runs
         FROM ingestion_metrics`,
      ).first<{ pushes: number; missed: number; runs: number }>(),
    ]);

    const rTotal = risingVotes?.total ?? 0;
    const lTotal = liveVotes?.total ?? 0;
    const pushes = ingestRow?.pushes ?? 0;
    const missed = ingestRow?.missed ?? 0;
    const totalIngest = pushes + missed;
    const totalAlerts = alertClaims?.total_alerts ?? 0;

    const scorecard: ScorecardData = {
      rising: {
        precision:
          rTotal >= SCORECARD_SAMPLE_FLOOR
            ? Math.round(((risingVotes?.useful_count ?? 0) / rTotal) * 1000) / 1000
            : null,
        sampleSize: rTotal,
        sampleFloor: SCORECARD_SAMPLE_FLOOR,
        status: rTotal >= SCORECARD_SAMPLE_FLOOR ? 'ready' : 'not enough data yet',
      },
      liveMoments: {
        precision:
          lTotal >= SCORECARD_SAMPLE_FLOOR
            ? Math.round(((liveVotes?.useful_count ?? 0) / lTotal) * 1000) / 1000
            : null,
        sampleSize: lTotal,
        sampleFloor: SCORECARD_SAMPLE_FLOOR,
        status: lTotal >= SCORECARD_SAMPLE_FLOOR ? 'ready' : 'not enough data yet',
      },
      avgTimeToAlertMs:
        latencyRow?.avg_ms !== null && latencyRow?.avg_ms !== undefined
          ? Math.max(0, Math.round(latencyRow.avg_ms))
          : null,
      missedPushRate:
        totalIngest > 0 ? Math.round((missed / totalIngest) * 1000) / 1000 : null,
      alertToClaimRate:
        totalAlerts > 0
          ? Math.round(((alertClaims?.claimed_items ?? 0) / totalAlerts) * 1000) / 1000
          : null,
      telemetry: {
        pushesReceived: pushes,
        missedPushes: missed,
        reconcileRuns: ingestRow?.runs ?? 0,
      },
      source: 'd1',
      asOf: new Date().toISOString(),
    };

    return c.json(scorecard);
  });

  router.get('/reports/daily', async (c) => {
    const principal = c.get('principal');

    const ws = await c.env.DB.prepare('SELECT timezone FROM workspaces WHERE id = ?')
      .bind(principal.workspaceId)
      .first<{ timezone: string }>();

    const timezone = ws?.timezone ?? 'UTC';
    const targetDate = c.req.query('date') ?? formatDateInTimezone(new Date(), timezone);

    const [membersRes, alertsRes, claimsRes, clipsRes] = await Promise.all([
      c.env.DB.prepare(
        'SELECT user_id, email FROM memberships WHERE workspace_id = ? ORDER BY created_at ASC',
      )
        .bind(principal.workspaceId)
        .all<{ user_id: string; email: string }>(),
      c.env.DB.prepare(
        'SELECT created_at FROM alerts WHERE workspace_id = ?',
      )
        .bind(principal.workspaceId)
        .all<{ created_at: string }>(),
      c.env.DB.prepare(
        'SELECT user_id, status, created_at FROM claims WHERE workspace_id = ?',
      )
        .bind(principal.workspaceId)
        .all<{ user_id: string; status: string; created_at: string }>(),
      c.env.DB.prepare(
        'SELECT user_id, created_at FROM clips WHERE workspace_id = ?',
      )
        .bind(principal.workspaceId)
        .all<{ user_id: string | null; created_at: string }>(),
    ]);

    const inDay = (iso: string) => {
      const d = new Date(iso);
      return !Number.isNaN(d.getTime()) && formatDateInTimezone(d, timezone) === targetDate;
    };

    const dayAlerts = (alertsRes.results ?? []).filter((a) => inDay(a.created_at));
    const dayClaims = (claimsRes.results ?? []).filter((cl) => inDay(cl.created_at));
    const dayClips = (clipsRes.results ?? []).filter((cp) => inDay(cp.created_at));

    const members = (membersRes.results ?? []).map((m) => {
      const mClaims = dayClaims.filter((cl) => cl.user_id === m.user_id);
      const mClips = dayClips.filter((cp) => cp.user_id === m.user_id);
      return {
        userId: m.user_id,
        email: m.email,
        claimsCount: mClaims.length,
        clippedCount: mClaims.filter((cl) => cl.status === 'Clipped').length,
        clipsLoggedCount: mClips.length,
      };
    });

    const teamSummary = {
      alertsCount: dayAlerts.length,
      claimsCount: dayClaims.length,
      clippedCount: dayClaims.filter(
        (cl) => cl.status === 'Clipped' || cl.status === 'Published',
      ).length,
      clipsLoggedCount: dayClips.length,
    };

    const digestInput = {
      dateIso: targetDate,
      workspaceName: '',
      metrics: teamSummary,
    };

    const aiParam = c.req.query('ai');
    const aiRequested = aiParam === 'true' || aiParam === '1';

    let aiInsightsUsed = false;
    let aiStatus: DailyReportData['aiStatus'] = 'off';
    let narrative = formatDeterministicDailyNarrative(digestInput);
    let fallbackReason: string | null = null;

    if (aiRequested) {
      const provider = new GeminiInsightsProvider({
        apiKey: c.env.GEMINI_API_KEY,
        enabled: true,
        gatewayUrl: c.env.AI_GATEWAY_URL,
      });
      const result = await provider.summarizeDailyDigestWithResult(digestInput);
      aiInsightsUsed = result.aiInsightsUsed;
      aiStatus = result.status;
      narrative = result.narrative;
      fallbackReason = result.fallbackReason;
    }

    const report: DailyReportData = {
      date: targetDate,
      timezone,
      aiInsightsUsed,
      aiStatus,
      narrative,
      fallbackReason,
      teamSummary,
      members,
      source: 'd1',
      asOf: new Date().toISOString(),
    };

    return c.json(report);
  });

  router.get('/reports/weekly', async (c) => {
    const principal = c.get('principal');

    const ws = await c.env.DB.prepare('SELECT timezone FROM workspaces WHERE id = ?')
      .bind(principal.workspaceId)
      .first<{ timezone: string }>();

    const timezone = ws?.timezone ?? 'UTC';
    const endDate = c.req.query('endDate') ?? formatDateInTimezone(new Date(), timezone);
    const daysList = enumerateLast7Days(endDate);
    const startDate = daysList[0] ?? endDate;
    const daySet = new Set(daysList);

    const [membersRes, alertsRes, claimsRes, clipsRes] = await Promise.all([
      c.env.DB.prepare(
        'SELECT user_id, email FROM memberships WHERE workspace_id = ? ORDER BY created_at ASC',
      )
        .bind(principal.workspaceId)
        .all<{ user_id: string; email: string }>(),
      c.env.DB.prepare('SELECT created_at FROM alerts WHERE workspace_id = ?')
        .bind(principal.workspaceId)
        .all<{ created_at: string }>(),
      c.env.DB.prepare('SELECT user_id, status, created_at FROM claims WHERE workspace_id = ?')
        .bind(principal.workspaceId)
        .all<{ user_id: string; status: string; created_at: string }>(),
      c.env.DB.prepare(
        'SELECT user_id, manual_revenue_cents, created_at FROM clips WHERE workspace_id = ?',
      )
        .bind(principal.workspaceId)
        .all<{ user_id: string | null; manual_revenue_cents: number | null; created_at: string }>(),
    ]);

    const toLocalDay = (iso: string): string | null => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      const ymd = formatDateInTimezone(d, timezone);
      return daySet.has(ymd) ? ymd : null;
    };

    const dayBuckets = new Map(
      daysList.map((date) => [
        date,
        { date, alertsCount: 0, claimsCount: 0, clippedCount: 0, clipsLoggedCount: 0 },
      ]),
    );

    const weekClaims: Array<{ user_id: string; status: string }> = [];
    const weekClips: Array<{ user_id: string | null; manual_revenue_cents: number | null }> = [];
    let alertsTotal = 0;

    for (const a of alertsRes.results ?? []) {
      const day = toLocalDay(a.created_at);
      if (!day) continue;
      alertsTotal += 1;
      const b = dayBuckets.get(day);
      if (b) b.alertsCount += 1;
    }

    for (const cl of claimsRes.results ?? []) {
      const day = toLocalDay(cl.created_at);
      if (!day) continue;
      weekClaims.push(cl);
      const b = dayBuckets.get(day);
      if (b) {
        b.claimsCount += 1;
        if (cl.status === 'Clipped' || cl.status === 'Published') {
          b.clippedCount += 1;
        }
      }
    }

    for (const cp of clipsRes.results ?? []) {
      const day = toLocalDay(cp.created_at);
      if (!day) continue;
      weekClips.push(cp);
      const b = dayBuckets.get(day);
      if (b) b.clipsLoggedCount += 1;
    }

    const members = (membersRes.results ?? []).map((m) => {
      const mClaims = weekClaims.filter((cl) => cl.user_id === m.user_id);
      const mClips = weekClips.filter((cp) => cp.user_id === m.user_id);
      return {
        userId: m.user_id,
        email: m.email,
        claimsCount: mClaims.length,
        clippedCount: mClaims.filter(
          (cl) => cl.status === 'Clipped' || cl.status === 'Published',
        ).length,
        clipsLoggedCount: mClips.length,
      };
    });

    const weekly: WeeklyReportData = {
      startDate,
      endDate: daysList[daysList.length - 1] ?? endDate,
      timezone,
      teamSummary: {
        alertsCount: alertsTotal,
        claimsCount: weekClaims.length,
        clippedCount: weekClaims.filter(
          (cl) => cl.status === 'Clipped' || cl.status === 'Published',
        ).length,
        clipsLoggedCount: weekClips.length,
        manualRevenueCents: weekClips.reduce(
          (sum, cp) => sum + (cp.manual_revenue_cents ?? 0),
          0,
        ),
      },
      days: Array.from(dayBuckets.values()),
      members,
      source: 'd1',
      asOf: new Date().toISOString(),
    };

    return c.json(weekly);
  });

  return router;
}
