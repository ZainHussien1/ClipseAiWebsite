import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Users } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { CreatorDetailView } from '../components/ui/CreatorDetailView';
import { EmptyState } from '../components/ui/EmptyState';
import { fetchCreators } from '../lib/api-v1';
import { formatCount, normalizeHandle } from '../lib/url';

export function CreatorsPage({ accountId }: { accountId?: string }) {
  const creatorsQuery = useQuery({
    queryKey: ['creators'],
    queryFn: fetchCreators,
    enabled: !accountId,
  });

  if (accountId) {
    return <CreatorDetailView accountId={accountId} />;
  }

  const creators = creatorsQuery.data?.creators ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">
            Creators Intelligence
          </h1>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Baselines, observed cadence, team ROI, notes, and webhook health per creator.
          </p>
        </div>
        <Link
          to="/sources"
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] font-medium"
        >
          Manage Sources
        </Link>
      </div>

      {creatorsQuery.isLoading ? (
        <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading creators...</Card>
      ) : creatorsQuery.isError ? (
        <Card className="p-5 text-[12px] text-[var(--danger)]">
          {creatorsQuery.error instanceof Error ? creatorsQuery.error.message : 'Failed to load creators'}
        </Card>
      ) : creators.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No creators tracked yet"
          description="Add YouTube, Twitch, or Kick creators in Sources to build baselines and ROI history."
          action={
            <Link
              to="/sources"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-[12px] font-semibold text-[#0c1519]"
            >
              Add Sources
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {creators.map((c) => (
            <Link key={c.accountId} to="/creators/$accountId" params={{ accountId: c.accountId }}>
              <Card className="flex h-full flex-col justify-between p-4 transition-colors hover:border-[var(--input-border)] hover:bg-[var(--surface-2)]">
                <div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-semibold uppercase text-[var(--text-secondary)]">
                      {c.platform}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      Webhook: {c.subscriptionHealth.status}
                    </span>
                  </div>
                  <h2 className="mt-2 text-[14px] font-semibold text-[var(--text-strong)]">
                    {c.displayName || normalizeHandle(c.handle)}
                  </h2>
                  <div className="font-mono text-[11px] text-[var(--text-muted)]">
                    {normalizeHandle(c.handle)}
                  </div>
                  <p className="mt-2 text-[12px] text-[var(--text-secondary)]">{c.cadenceSummary}</p>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between border-t border-[var(--divider)] pt-2.5 text-[11px] text-[var(--text-secondary)]">
                  <span>
                    {c.laneCounts.videos}v · {c.laneCounts.shorts}s · {c.laneCounts.live}l
                  </span>
                  <span>
                    Clips: {c.teamRoi.clipsCount} · Med: {formatCount(c.teamRoi.medianClipViews)}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
