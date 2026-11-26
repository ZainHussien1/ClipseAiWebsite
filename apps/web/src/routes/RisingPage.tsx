import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Scissors, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { ClaimModal } from '../components/ui/ClaimModal';
import { EmptyState } from '../components/ui/EmptyState';
import { Sparkline } from '../components/ui/Sparkline';
import { fetchRising } from '../lib/api-v1';
import type { ActiveRisingTier, Platform } from '../lib/contracts';
import { formatAgeSeconds, safeExternalUrl } from '../lib/url';

const TIER_BADGE: Record<ActiveRisingTier, { label: string; bg: string; color: string }> = {
  viral: { label: 'Viral', bg: 'var(--danger-bg)', color: 'var(--danger)' },
  breakout: { label: 'Breakout', bg: 'var(--warning-bg)', color: 'var(--warning)' },
  rising: { label: 'Rising', bg: 'var(--accent-tint)', color: 'var(--accent)' },
};

export function RisingPage() {
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

  const items = risingQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Rising</h1>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Independently scored velocity and engagement breakouts with hysteresis.
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
          description="Items crossing Rising, Breakout, or Viral thresholds over a creator baseline appear here."
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => {
            const badge = TIER_BADGE[item.tier];
            const externalUrl = safeExternalUrl(item.url);
            return (
              <Card key={item.itemId} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                        style={{ backgroundColor: badge.bg, color: badge.color }}
                      >
                        {badge.label}
                      </span>
                      <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 uppercase text-[var(--text-secondary)]">
                        {item.platform}
                      </span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {item.accountDisplayName || item.accountHandle}
                      </span>
                    </div>
                    <h2 className="mt-1.5 text-[14px] font-semibold text-[var(--text-strong)]">
                      {item.title}
                    </h2>
                    <p className="mt-1 text-[12px] text-[var(--text-primary)]">{item.reason}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                      <span>Score: {item.score.toFixed(2)}</span>
                      <span>Velocity: {item.velocityRatio.toFixed(2)}x</span>
                      <span>Engagement: {item.engagementRatio.toFixed(2)}x</span>
                      <span>
                        {item.source} · {formatAgeSeconds(item.ageSeconds)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Sparkline
                      values={[1, item.velocityRatio, item.score]}
                      color={badge.color}
                      label={`Velocity ${item.velocityRatio.toFixed(2)}x, score ${item.score.toFixed(2)}`}
                    />
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
                    <button
                      type="button"
                      onClick={() => setClaimTarget({ id: item.itemId, title: item.title })}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-[#0c1519]"
                    >
                      <Scissors className="h-3.5 w-3.5" strokeWidth={1.8} />
                      Claim
                    </button>
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
