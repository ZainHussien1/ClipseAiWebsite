import { useInfiniteQuery } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Rss, Scissors } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { ClaimModal } from '../components/ui/ClaimModal';
import { EmptyState } from '../components/ui/EmptyState';
import { fetchFeed } from '../lib/api-v1';
import type { ItemKind, Platform } from '../lib/contracts';
import { formatAgeSeconds, formatCount, formatLatencyMs, safeExternalUrl } from '../lib/url';

export function FeedPage() {
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [kind, setKind] = useState<ItemKind | ''>('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [claimTarget, setClaimTarget] = useState<{ id: string; title: string } | null>(null);

  const feedQuery = useInfiniteQuery({
    queryKey: ['feed', { platform, kind, starredOnly, search }],
    queryFn: ({ pageParam }) =>
      fetchFeed({
        cursor: pageParam,
        limit: 25,
        platform: platform || undefined,
        kind: kind || undefined,
        starredOnly: starredOnly || undefined,
        q: search.trim() || undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const items = feedQuery.data?.pages.flatMap((p) => p.items) ?? [];

  const handleCopy = (id: string, url: string) => {
    const safe = safeExternalUrl(url);
    if (!safe) return;
    void navigator.clipboard.writeText(safe).then(() => {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Feed</h1>
        <p className="text-[12px] text-[var(--text-secondary)]">
          Keyset-paginated creator uploads and streams with first-seen latency stamps.
        </p>
      </div>

      <Card className="flex flex-wrap items-center gap-2.5 p-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter titles..."
          aria-label="Filter feed titles"
          className="min-h-[40px] min-w-[180px] flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
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
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ItemKind | '')}
          aria-label="Filter by kind"
          className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px] text-[var(--text-primary)]"
        >
          <option value="">All kinds</option>
          <option value="video">Video</option>
          <option value="short">Short</option>
          <option value="live">Live</option>
          <option value="vod">VOD</option>
          <option value="clip">Clip</option>
        </select>
        <button
          type="button"
          onClick={() => setStarredOnly((v) => !v)}
          className={`min-h-[40px] rounded-lg border px-3 text-[12px] font-medium ${
            starredOnly
              ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
              : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]'
          }`}
        >
          Starred only
        </button>
      </Card>

      {feedQuery.isLoading ? (
        <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading feed...</Card>
      ) : feedQuery.isError ? (
        <Card className="p-5 text-[12px] text-[var(--danger)]">
          {feedQuery.error instanceof Error ? feedQuery.error.message : 'Failed to load feed'}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Rss}
          title="No feed items match your filters"
          description="Add creator sources or adjust your filters. Real ingested items will appear here."
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => {
            const externalUrl = safeExternalUrl(item.url);
            return (
              <Card key={item.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-semibold uppercase text-[var(--text-secondary)]">
                        {item.platform}
                      </span>
                      <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 uppercase text-[var(--text-muted)]">
                        {item.kind}
                      </span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {item.accountDisplayName || item.accountHandle}
                      </span>
                      {item.claimStatus && (
                        <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                          {item.claimStatus}
                        </span>
                      )}
                    </div>

                    <h2 className="mt-1.5 text-[14px] font-semibold text-[var(--text-strong)]">
                      {item.title}
                    </h2>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                      <span>Views: {formatCount(item.latestViews)}</span>
                      <span>First seen latency: {formatLatencyMs(item.ingestLatencyMs)}</span>
                      <span>
                        Source: {item.source} · {formatAgeSeconds(item.ageSeconds)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {externalUrl && (
                      <>
                        <a
                          href={externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open source link"
                          className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleCopy(item.id, externalUrl)}
                          aria-label="Copy source link"
                          className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          {copiedId === item.id ? (
                            <Check className="h-4 w-4 text-[var(--success)]" strokeWidth={1.5} />
                          ) : (
                            <Copy className="h-4 w-4" strokeWidth={1.5} />
                          )}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setClaimTarget({ id: item.id, title: item.title })}
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

          {feedQuery.hasNextPage && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => void feedQuery.fetchNextPage()}
                disabled={feedQuery.isFetchingNextPage}
                className="min-h-[44px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--input-border)] disabled:opacity-50"
              >
                {feedQuery.isFetchingNextPage ? 'Loading more...' : 'Load more'}
              </button>
            </div>
          )}
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
