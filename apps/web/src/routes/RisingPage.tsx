import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Scissors, Star, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { ClaimModal } from '../components/ui/ClaimModal';
import { EmptyState } from '../components/ui/EmptyState';
import { Sparkline } from '../components/ui/Sparkline';
import { deleteClaim, fetchRising, listSources, updateSource } from '../lib/api-v1';
import type { ActiveRisingTier, Platform } from '../lib/contracts';
import { formatAgeSeconds, formatProvenance, normalizeHandle, safeExternalUrl } from '../lib/url';

const TIER_BADGE: Record<ActiveRisingTier, { label: string; bg: string; color: string }> = {
  viral: { label: 'Viral', bg: 'var(--danger-bg)', color: 'var(--danger)' },
  breakout: { label: 'Breakout', bg: 'var(--warning-bg)', color: 'var(--warning)' },
  rising: { label: 'Rising', bg: 'var(--accent-tint)', color: 'var(--accent)' },
};

export function RisingPage() {
  const queryClient = useQueryClient();
  const [tier, setTier] = useState<ActiveRisingTier | ''>('');
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [claimTarget, setClaimTarget] = useState<{ id: string; title: string } | null>(null);

  const risingQuery = useQuery({
    queryKey: ['rising', { tier, platform }],
    queryFn: () =>
      fetchRising({
        tier: tier || undefined,
        platform: platform || undefined,
        limit: 25,
      }),
  });

  const sourcesQuery = useQuery({ queryKey: ['sources'], queryFn: listSources });
  const sourceByAccount = useMemo(
    () => new Map((sourcesQuery.data ?? []).map((s) => [s.accountId, s])),
    [sourcesQuery.data],
  );

  const unclaimMutation = useMutation({
    mutationFn: deleteClaim,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rising'] });
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
    },
  });

  const starMutation = useMutation({
    mutationFn: ({ followId, starred }: { followId: string; starred: boolean }) =>
      updateSource(followId, { starred }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['rising'] });
    },
  });

  const items = risingQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Rising</h1>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Snapshot-delta velocity against creator-kind baselines (&gt;=5 items &gt;7d old).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as ActiveRisingTier | '')}
            aria-label="Filter by rising tier"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px] text-[var(--text-primary)]"
          >
            <option value="">All tiers</option>
            <option value="viral">Viral</option>
            <option value="breakout">Breakout</option>
            <option value="rising">Rising</option>
          </select>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform | '')}
            aria-label="Filter by platform"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px] text-[var(--text-primary)]"
          >
            <option value="">All platforms</option>
            <option value="youtube">YouTube</option>
            <option value="twitch">Twitch</option>
            <option value="kick">Kick</option>
          </select>
        </div>
      </div>

      {risingQuery.isLoading ? (
        <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Evaluating rising items...</Card>
      ) : risingQuery.isError ? (
        <Card className="p-5 text-[12px] text-[var(--danger)]">
          {risingQuery.error instanceof Error ? risingQuery.error.message : 'Failed to load rising items'}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No rising items detected"
          description="Items crossing Rising, Breakout, or Viral thresholds over a creator's >=5-item baseline appear here."
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => {
            const badge = TIER_BADGE[item.tier];
            const externalUrl = safeExternalUrl(item.url);
            const follow = sourceByAccount.get(item.accountId);
            const claim = item.claim;
            const paceText = item.paceLabel ?? badge.label;
            const baselineText =
              item.baselineN !== undefined && item.baselineRequired !== undefined
                ? `Baseline: ${item.baselineN}/${item.baselineRequired}`
                : null;
            return (
              <Card key={item.itemId} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                        style={{ backgroundColor: badge.bg, color: badge.color }}
                      >
                        {paceText}
                      </span>
                      <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 uppercase text-[var(--text-secondary)]">
                        {item.platform}
                      </span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {item.accountDisplayName || normalizeHandle(item.accountHandle)}
                      </span>
                      {item.isBackfill && (
                        <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                          Backfilled
                        </span>
                      )}
                      {claim && (
                        <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                          {claim.status} by {claim.claimedByMe ? 'you' : (claim.email ?? 'teammate')}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1.5 text-[14px] font-semibold text-[var(--text-strong)]">
                      {item.title}
                    </h2>
                    <p className="mt-1 text-[12px] text-[var(--text-primary)]">{item.reason}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                      <span>Score: {item.score.toFixed(2)}</span>
                      <span>Velocity: {item.velocityRatio.toFixed(2)}x</span>
                      <span>
                        Engagement:{' '}
                        {item.engagementRatio !== null
                          ? `${item.engagementRatio.toFixed(2)}x`
                          : 'n/a'}
                      </span>
                      {baselineText && <span>{baselineText}</span>}
                      <span>
                        {formatProvenance(item.source, item.platform)} ·{' '}
                        {formatAgeSeconds(item.ageSeconds)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Sparkline
                      values={item.snapshots ?? []}
                      snapshotCount={item.snapshotCount}
                      color={badge.color}
                      label={`Velocity ${item.velocityRatio.toFixed(2)}x, score ${item.score.toFixed(2)}`}
                    />
                    {follow && (
                      <button
                        type="button"
                        aria-label={follow.starred ? 'Unstar creator' : 'Star creator'}
                        onClick={() =>
                          starMutation.mutate({
                            followId: follow.followId,
                            starred: !follow.starred,
                          })
                        }
                        className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border ${
                          follow.starred
                            ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]'
                            : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
                        }`}
                      >
                        <Star className="h-4 w-4" strokeWidth={1.5} />
                      </button>
                    )}
                    {externalUrl && (
                      <a
                        href={externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open rising item"
                        className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
                      </a>
                    )}
                    {claim ? (
                      claim.claimedByMe ? (
                        <button
                          type="button"
                          disabled={unclaimMutation.isPending}
                          onClick={() => unclaimMutation.mutate(claim.id)}
                          className="min-h-[40px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
                        >
                          Unclaim
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="min-h-[40px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] font-medium text-[var(--text-muted)] opacity-60"
                        >
                          Claimed
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => setClaimTarget({ id: item.itemId, title: item.title })}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-[#0c1519]"
                      >
                        <Scissors className="h-3.5 w-3.5" strokeWidth={1.8} />
                        Claim
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {claimTarget && (
        <ClaimModal
          itemId={claimTarget.id}
          itemTitle={claimTarget.title}
          onClose={() => setClaimTarget(null)}
        />
      )}
    </div>
  );
}
