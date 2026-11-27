import { useQuery } from '@tanstack/react-query';
import { FileBarChart2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import {
  fetchDailyReport,
  fetchScorecard,
  fetchSourceRoi,
  fetchWeeklyReport,
} from '../lib/api-v1';
import { formatCount, formatLatencyMs } from '../lib/url';

type ReportTab = 'daily' | 'weekly' | 'roi' | 'scorecard';

function todayInLocalIso(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('daily');
  const [date, setDate] = useState(todayInLocalIso);
  const [aiEnabled, setAiEnabled] = useState(false);

  const dailyQuery = useQuery({
    queryKey: ['reports', 'daily', date, aiEnabled],
    queryFn: () => fetchDailyReport(date, aiEnabled),
    enabled: tab === 'daily',
  });

  const weeklyQuery = useQuery({
    queryKey: ['reports', 'weekly'],
    queryFn: fetchWeeklyReport,
    enabled: tab === 'weekly',
  });

  const roiQuery = useQuery({
    queryKey: ['reports', 'roi'],
    queryFn: fetchSourceRoi,
    enabled: tab === 'roi',
  });

  const scorecardQuery = useQuery({
    queryKey: ['reports', 'scorecard'],
    queryFn: fetchScorecard,
    enabled: tab === 'scorecard',
    retry: false,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Reports</h1>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Daily &amp; weekly rollups, optional grounded Insights, source ROI, and accuracy scorecard.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['daily', 'Daily Report'],
              ['weekly', 'Weekly Report'],
              ['roi', 'Source ROI'],
              ['scorecard', 'Accuracy Scorecard'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`min-h-[38px] rounded-lg border px-3 text-[12px] font-medium ${
                tab === key
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'daily' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Report date"
              className="min-h-[38px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px] text-[var(--text-primary)]"
            />
            <button
              type="button"
              onClick={() => setAiEnabled((v) => !v)}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium ${
                aiEnabled
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              AI Insights: {aiEnabled ? 'On' : 'Off'}
            </button>
            {dailyQuery.data && (
              <span className="text-[11px] text-[var(--text-muted)]">
                TZ: {dailyQuery.data.timezone} · Status: {dailyQuery.data.aiStatus ?? 'off'}
              </span>
            )}
          </div>

          {dailyQuery.isLoading ? (
            <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading daily report...</Card>
          ) : dailyQuery.data ? (
            <>
              {dailyQuery.data.narrative && (
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 font-semibold text-[var(--accent)]">
                      Insights
                    </span>
                    {dailyQuery.data.fallbackReason && (
                      <span className="text-[var(--text-muted)]">
                        Deterministic fallback ({dailyQuery.data.fallbackReason})
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[13px] text-[var(--text-primary)]">
                    {dailyQuery.data.narrative}
                  </p>
                </Card>
              )}

              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ['Alerts', dailyQuery.data.teamSummary.alertsCount],
                  ['Claims', dailyQuery.data.teamSummary.claimsCount],
                  ['Clipped', dailyQuery.data.teamSummary.clippedCount],
                  ['Clips Logged', dailyQuery.data.teamSummary.clipsLoggedCount],
                ].map(([label, val]) => (
                  <Card key={String(label)} className="p-4">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                      {label}
                    </div>
                    <div className="mt-1 text-[20px] font-bold text-[var(--text-strong)]">{val}</div>
                  </Card>
                ))}
              </div>

              <Card className="p-4">
                <h2 className="text-[13px] font-semibold text-[var(--text-strong)]">
                  Member Breakdown ({dailyQuery.data.date})
                </h2>
                {dailyQuery.data.members.length === 0 ? (
                  <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
                    No member activity recorded for this date.
                  </p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-[12px]">
                      <thead className="border-b border-[var(--divider)] text-[11px] text-[var(--text-muted)]">
                        <tr>
                          <th className="py-2">Member</th>
                          <th className="py-2">Claims</th>
                          <th className="py-2">Clipped</th>
                          <th className="py-2">Clips Logged</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--divider)]">
                        {dailyQuery.data.members.map((m) => (
                          <tr key={m.userId}>
                            <td className="py-2 text-[var(--text-primary)]">{m.email}</td>
                            <td className="py-2 font-mono">{m.claimsCount}</td>
                            <td className="py-2 font-mono">{m.clippedCount}</td>
                            <td className="py-2 font-mono">{m.clipsLoggedCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          ) : null}
        </div>
      )}

      {tab === 'weekly' && (
        <div className="space-y-3">
          {weeklyQuery.isLoading ? (
            <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading weekly report...</Card>
          ) : weeklyQuery.data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-5">
                {[
                  ['Alerts (7d)', weeklyQuery.data.teamSummary.alertsCount],
                  ['Claims (7d)', weeklyQuery.data.teamSummary.claimsCount],
                  ['Clipped (7d)', weeklyQuery.data.teamSummary.clippedCount],
                  ['Clips Logged', weeklyQuery.data.teamSummary.clipsLoggedCount],
                  [
                    'Manual Rev',
                    `$${(weeklyQuery.data.teamSummary.manualRevenueCents / 100).toFixed(2)}`,
                  ],
                ].map(([label, val]) => (
                  <Card key={String(label)} className="p-3.5">
                    <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                      {label}
                    </div>
                    <div className="mt-1 text-[18px] font-bold text-[var(--text-strong)]">{val}</div>
                  </Card>
                ))}
              </div>
              <Card className="p-4">
                <h2 className="text-[13px] font-semibold text-[var(--text-strong)]">
                  7-Day Rollup ({weeklyQuery.data.startDate} &rarr; {weeklyQuery.data.endDate},{' '}
                  {weeklyQuery.data.timezone})
                </h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead className="border-b border-[var(--divider)] text-[11px] text-[var(--text-muted)]">
                      <tr>
                        <th className="py-2">Date</th>
                        <th className="py-2">Alerts</th>
                        <th className="py-2">Claims</th>
                        <th className="py-2">Clipped</th>
                        <th className="py-2">Clips Logged</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--divider)]">
                      {weeklyQuery.data.days.map((d) => (
                        <tr key={d.date}>
                          <td className="py-2 font-mono">{d.date}</td>
                          <td className="py-2 font-mono">{d.alertsCount}</td>
                          <td className="py-2 font-mono">{d.claimsCount}</td>
                          <td className="py-2 font-mono">{d.clippedCount}</td>
                          <td className="py-2 font-mono">{d.clipsLoggedCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      )}

      {tab === 'roi' && (
        <Card className="p-4">
          {roiQuery.isLoading ? (
            <div className="text-[12px] text-[var(--text-secondary)]">Loading source ROI...</div>
          ) : (roiQuery.data ?? []).length === 0 ? (
            <EmptyState
              icon={FileBarChart2}
              title="No source ROI entries yet"
              description="Track sources and log clips to measure claims, clip views, and ROI."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="border-b border-[var(--divider)] text-[11px] text-[var(--text-muted)]">
                  <tr>
                    <th className="py-2">Creator</th>
                    <th className="py-2">Platform</th>
                    <th className="py-2">Claims</th>
                    <th className="py-2">Clips</th>
                    <th className="py-2">Total Views</th>
                    <th className="py-2">Clips / Claim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--divider)]">
                  {(roiQuery.data ?? []).map((row) => (
                    <tr key={row.accountId}>
                      <td className="py-2 font-medium text-[var(--text-strong)]">
                        {row.displayName || row.handle}
                      </td>
                      <td className="py-2 uppercase text-[var(--text-secondary)]">{row.platform}</td>
                      <td className="py-2 font-mono">{row.claimsCount}</td>
                      <td className="py-2 font-mono">{row.clipsCount}</td>
                      <td className="py-2 font-mono">{formatCount(row.totalClipViews)}</td>
                      <td className="py-2 font-mono">
                        {row.status === 'not enough data yet' || row.clipsPerClaim === null
                          ? `not enough data yet (floor ${row.sampleFloor})`
                          : row.clipsPerClaim.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'scorecard' && (
        <Card className="p-4">
          {scorecardQuery.isLoading ? (
            <div className="text-[12px] text-[var(--text-secondary)]">Loading scorecard...</div>
          ) : scorecardQuery.isError ? (
            <div className="text-[12px] text-[var(--danger)]">
              {scorecardQuery.error instanceof Error
                ? scorecardQuery.error.message
                : 'Scorecard requires Admin or Owner role.'}
            </div>
          ) : scorecardQuery.data ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Rising Precision', scorecardQuery.data.rising],
                  ['Live Moments Precision', scorecardQuery.data.liveMoments],
                ].map(([label, metric]) => {
                  const m = metric as {
                    precision: number | null;
                    sampleSize: number;
                    sampleFloor: number;
                    status: 'ready' | 'not enough data yet';
                  };
                  return (
                    <div
                      key={String(label)}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5"
                    >
                      <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                        {String(label)}
                      </div>
                      <div className="mt-1 text-[16px] font-semibold text-[var(--text-strong)]">
                        {m.status === 'not enough data yet' || m.precision === null
                          ? 'not enough data yet'
                          : `${(m.precision * 100).toFixed(1)}%`}
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                        Sample size: {m.sampleSize} / floor {m.sampleFloor}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid gap-3 text-[12px] sm:grid-cols-3">
                <div>
                  Avg time-to-alert:{' '}
                  <span className="font-mono text-[var(--text-strong)]">
                    {formatLatencyMs(scorecardQuery.data.avgTimeToAlertMs)}
                  </span>
                </div>
                <div>
                  Missed pushes:{' '}
                  <span className="font-mono text-[var(--text-strong)]">
                    {scorecardQuery.data.telemetry.missedPushes} /{' '}
                    {scorecardQuery.data.telemetry.pushesReceived}
                  </span>
                </div>
                <div>
                  Reconcile runs:{' '}
                  <span className="font-mono text-[var(--text-strong)]">
                    {scorecardQuery.data.telemetry.reconcileRuns}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
