import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Activity, ArrowRight, Flame, Radio, Rss, Scissors } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ProviderStatusBar } from '../components/ui/ProviderStatusBar';
import { claimFromAlert, fetchMissionControl } from '../lib/api-v1';
import {
  formatAgeSeconds,
  formatCount,
  formatDurationSince,
  formatLatencyMs,
  formatProvenance,
  normalizeHandle,
} from '../lib/url';

export function MissionControlPage() {
  const queryClient = useQueryClient();
  const mcQuery = useQuery({
    queryKey: ['mission-control'],
    queryFn: fetchMissionControl,
    refetchInterval: 30_000,
  });

  const claimMutation = useMutation({
    mutationFn: claimFromAlert,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mission-control'] });
      void queryClient.invalidateQueries({ queryKey: ['work-board'] });
    },
  });

  if (mcQuery.isLoading) {
    return <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading Mission Control...</Card>;
  }

  if (mcQuery.isError || !mcQuery.data) {
    return (
      <Card className="p-5 text-[12px] text-[var(--danger)]">
        {mcQuery.error instanceof Error ? mcQuery.error.message : 'Failed to load Mission Control'}
      </Card>
    );
  }

  const data = mcQuery.data;

  if (!data.hasSources && !data.hasItems) {
    return (
      <div className="space-y-4">
        <ProviderStatusBar />
        <EmptyState
          icon={Rss}
          title="Connect your first creator to launch Mission Control"
          description="Add a YouTube, Twitch, or Kick channel in Creators to start ingesting uploads, live streams, and rising signals."
          action={
            <Link
              to="/sources"
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-[12px] font-semibold text-[#0c1519]"
            >
              Add Creators
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
            </Link>
          }
        />
      </div>
    );
  }

  const { kpis } = data;
  const lastIngestSec = data.providerHealth.lastIngestAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(data.providerHealth.lastIngestAt)) / 1000))
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Mission Control</h1>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Live workspace operations, unclaimed signals, and team throughput.
          </p>
        </div>
        <div className="text-[11px] text-[var(--text-muted)]">
          Last ingest: {lastIngestSec !== null ? formatAgeSeconds(lastIngestSec) : 'no ingest yet'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">New Items (24h)</div>
          <div className="mt-1 text-[20px] font-bold text-[var(--text-strong)]">
            {kpis.newItems24h.total}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
            {kpis.newItems24h.videos}v · {kpis.newItems24h.shorts}s · {kpis.newItems24h.live}l
          </div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Live Now</div>
          <div className="mt-1 text-[20px] font-bold text-[var(--text-strong)]">
            {kpis.liveNowCount}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">Active streams</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Hot Unclaimed</div>
          <div className="mt-1 text-[20px] font-bold text-[var(--accent)]">
            {kpis.hotUnclaimedCount}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">Open alerts</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Claims in Progress</div>
          <div className="mt-1 text-[20px] font-bold text-[var(--text-strong)]">
            {kpis.claimsInProgressCount}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">Claimed / Clipping</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Clips Today</div>
          <div className="mt-1 text-[20px] font-bold text-[var(--success)]">
            {kpis.clipsTodayCount}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">Logged today</div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Median Alert (7d)</div>
          <div className="mt-1 text-[20px] font-bold text-[var(--text-strong)]">
            {formatLatencyMs(kpis.medianTimeToAlertMs7d)}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">Non-backfill</div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="p-4 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-[var(--divider)] pb-2.5">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-strong)]">
              <Flame className="h-4 w-4 text-[var(--warning)]" strokeWidth={1.5} />
              Needs Attention ({data.needsAttention.length})
            </h2>
            <Link to="/work" className="text-[12px] text-[var(--accent)]">
              Open Work Board
            </Link>
          </div>
          {data.needsAttention.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-[var(--text-secondary)]">
              All signals and claims are handled.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {data.needsAttention.map((entry) => (
                <div
                  key={entry.alertId ?? entry.claimId ?? entry.itemId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="rounded border border-[var(--border)] px-1.5 py-0.5 uppercase text-[var(--text-secondary)]">
                        {entry.platform}
                      </span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {entry.creatorName}
                      </span>
                      <span className="text-[var(--text-muted)]">
                        {formatAgeSeconds(entry.ageSeconds)}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-[13px] font-semibold text-[var(--text-strong)]">
                      {entry.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      {entry.reason}
                    </div>
                  </div>
                  {entry.alertId ? (
                    <button
                      type="button"
                      disabled={claimMutation.isPending}
                      onClick={() => claimMutation.mutate(entry.alertId ?? '')}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-[#0c1519]"
                    >
                      <Scissors className="h-3.5 w-3.5" strokeWidth={1.8} />
                      Claim
                    </button>
                  ) : (
                    <Link
                      to="/work"
                      className="inline-flex min-h-[36px] items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] text-[var(--text-primary)]"
                    >
                      Review
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-[var(--divider)] pb-2.5">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-strong)]">
              <Radio className="h-4 w-4 text-[var(--danger)]" strokeWidth={1.5} />
              Live Now ({data.liveNowRail.length})
            </h2>
            <Link to="/live" className="text-[12px] text-[var(--accent)]">
              View all
            </Link>
          </div>
          {data.liveNowRail.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-[var(--text-secondary)]">
              No tracked creators live right now.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {data.liveNowRail.map((s) => (
                <div
                  key={s.itemId}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-[var(--text-strong)]">
                      {s.accountDisplayName || normalizeHandle(s.accountHandle)}
                    </span>
                    <span className="font-mono text-[var(--danger)]">
                      {formatCount(s.viewers)} viewers
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[12px] text-[var(--text-primary)]">{s.title}</div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                    Duration: {formatDurationSince(s.startedAt)} ·{' '}
                    {formatProvenance(s.source, s.platform)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="p-4 lg:col-span-6">
          <div className="flex items-center justify-between border-b border-[var(--divider)] pb-2.5">
            <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">Rising Top 5</h2>
            <Link to="/rising" className="text-[12px] text-[var(--accent)]">
              Open Rising
            </Link>
          </div>
          {data.risingTop5.length === 0 ? (
            <p className="py-5 text-center text-[12px] text-[var(--text-secondary)]">
              No rising breakouts detected yet.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {data.risingTop5.map((r) => (
                <div
                  key={r.itemId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-[var(--text-strong)]">{r.title}</div>
                    <div className="text-[11px] text-[var(--text-secondary)]">{r.reason}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                    {r.velocityRatio.toFixed(1)}x
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 lg:col-span-6">
          <div className="flex items-center justify-between border-b border-[var(--divider)] pb-2.5">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-strong)]">
              <Activity className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.5} />
              Team Activity &amp; Provider Health
            </h2>
          </div>
          <div className="mt-3">
            <ProviderStatusBar />
          </div>
          {data.teamActivity.length === 0 ? (
            <p className="py-4 text-[12px] text-[var(--text-secondary)]">
              No team activity recorded yet.
            </p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {data.teamActivity.slice(0, 6).map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-2 border-b border-[var(--divider)] py-1.5 text-[12px] last:border-b-0"
                >
                  <span className="truncate text-[var(--text-primary)]">{ev.summary}</span>
                  <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                    {ev.actorEmail ?? 'system'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
