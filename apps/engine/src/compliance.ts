export interface ComplianceReport {
  readonly purgedYouTubeItems: number;
  readonly expiredSubscriptions: number;
  readonly leasesNeedingRenewal: number;
}

const THIRTY_DAYS_MS = 30 * 86_400_000;
const ONE_DAY_MS = 86_400_000;

/**
 * §4.2 Compliance: YouTube raw metadata (titles, descriptions, stats) must be
 * refreshed or deleted within 30 calendar days. Also tracks webhook lease health.
 */
export async function enforceYouTube30DayCompliance(
  db: D1Database,
  nowIso: string = new Date().toISOString(),
): Promise<ComplianceReport> {
  const nowMs = Date.parse(nowIso);
  const cutoffIso = new Date(nowMs - THIRTY_DAYS_MS).toISOString();
  const renewalHorizonIso = new Date(nowMs + ONE_DAY_MS).toISOString();

  const deleteResult = await db
    .prepare(`DELETE FROM items WHERE platform = 'youtube' AND raw_refreshed_at < ?`)
    .bind(cutoffIso)
    .run();

  const expireResult = await db
    .prepare(
      `UPDATE webhook_subscriptions
       SET status = 'expired', updated_at = ?
       WHERE status = 'active' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
    )
    .bind(nowIso, nowIso)
    .run();

  const renewalRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM webhook_subscriptions
       WHERE status = 'active' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`,
    )
    .bind(renewalHorizonIso)
    .first<{ cnt: number }>();

  return {
    purgedYouTubeItems: deleteResult.meta?.changes ?? 0,
    expiredSubscriptions: expireResult.meta?.changes ?? 0,
    leasesNeedingRenewal: renewalRow?.cnt ?? 0,
  };
}
