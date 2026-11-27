import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookmarkPlus, CheckCheck, RefreshCw, Rss, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { ClaimModal } from '../components/ui/ClaimModal';
import { EmptyState } from '../components/ui/EmptyState';
import { FeedItemCard } from '../components/ui/FeedItemCard';
import { ItemDetailDrawer } from '../components/ui/ItemDetailDrawer';
import {
  createSavedView,
  deleteClaim,
  deleteSavedView,
  fetchFeed,
  fetchProviderStatus,
  listSavedViews,
  listSources,
  markItemsSeen,
  syncAllSources,
  updateSource,
} from '../lib/api-v1';
import type { FeedAge, FeedItem, FeedLane, FeedSort, Platform } from '../lib/contracts';
import { normalizeHandle, safeExternalUrl } from '../lib/url';

export function FeedPage() {
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [lane, setLane] = useState<FeedLane | ''>('');
  const [sort, setSort] = useState<FeedSort>('newest');
  const [age, setAge] = useState<FeedAge | ''>('');
  const [unseenOnly, setUnseenOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');
  const [viewName, setViewName] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [claimTarget, setClaimTarget] = useState<{ id: string; title: string } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const feedQuery = useInfiniteQuery({
    queryKey: ['feed', { platform, lane, sort, age, unseenOnly, starredOnly, accountId, search }],
    queryFn: ({ pageParam }) =>
      fetchFeed({
        cursor: pageParam,
        limit: 25,
        platform: platform || undefined,
        lane: lane || undefined,
        sort,
        age: age || undefined,
        unseenOnly: unseenOnly || undefined,
        starredOnly: starredOnly || undefined,
        accountId: accountId || undefined,
        q: search.trim() || undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const providerQuery = useQuery({ queryKey: ['providers', 'status'], queryFn: fetchProviderStatus, staleTime: 60_000 });
  const sourcesQuery = useQuery({ queryKey: ['sources'], queryFn: listSources });
  const viewsQuery = useQuery({ queryKey: ['saved-views'], queryFn: listSavedViews });

  const sourceByAccount = useMemo(
    () => new Map((sourcesQuery.data ?? []).map((s) => [s.accountId, s])),
    [sourcesQuery.data],
  );

  const firstPage = feedQuery.data?.pages[0];
  const items = useMemo(() => feedQuery.data?.pages.flatMap((p) => p.items) ?? [], [feedQuery.data]);
  const laneCounts = firstPage?.laneCounts ?? { videos: 0, shorts: 0, live: 0, unclassified: 0 };
  const creatorsRail = firstPage?.creatorsRail ?? [];

  const syncMutation = useMutation({
    mutationFn: syncAllSources,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });

  const seenMutation = useMutation({
    mutationFn: markItemsSeen,
    onSuccess: () => {
      setSelectedIds(new Set());
      setToastMsg('Marked items as seen.');
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const unclaimMutation = useMutation({
    mutationFn: deleteClaim,
    onSuccess: () => {
      setToastMsg('Claim removed.');
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['work-board'] });
    },
  });

  const starMutation = useMutation({
    mutationFn: ({ followId, starred }: { followId: string; starred: boolean }) =>
      updateSource(followId, { starred }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const saveViewMutation = useMutation({
    mutationFn: () =>
      createSavedView(viewName.trim(), {
        platform: platform || undefined,
        lane: lane || undefined,
        sort,
        age: age || undefined,
        unseenOnly: unseenOnly || undefined,
        starredOnly: starredOnly || undefined,
        accountId: accountId || undefined,
        q: search.trim() || undefined,
      }),
    onSuccess: () => {
      setViewName('');
      void queryClient.invalidateQueries({ queryKey: ['saved-views'] });
    },
  });

  const deleteViewMutation = useMutation({
    mutationFn: deleteSavedView,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved-views'] }),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey) return;
      const focused = items[focusedIdx];
      const k = e.key.toLowerCase();
      if (k === 'j') setFocusedIdx((i) => Math.min(items.length - 1, i + 1));
      else if (k === 'k') setFocusedIdx((i) => Math.max(0, i - 1));
      else if (k === '?' || e.key === '?') setShortcutsOpen((v) => !v);
      else if (k === 'o' && focused) setDetailItemId(focused.id);
      else if (k === 'c' && focused && !focused.claim) setClaimTarget({ id: focused.id, title: focused.title });
      else if (k === 'x' && focused) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(focused.id)) next.delete(focused.id);
          else next.add(focused.id);
          return next;
        });
      } else if (k === 's' && focused) {
        const f = sourceByAccount.get(focused.accountId);
        if (f) starMutation.mutate({ followId: f.followId, starred: !f.starred });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, focusedIdx, sourceByAccount, starMutation]);

  const unconfiguredSelected =
    (platform === 'twitch' && providerQuery.data?.twitch.status === 'credentials_missing') ||
    (platform === 'kick' && providerQuery.data?.kick.status === 'credentials_missing');

  const videos = useMemo(() => items.filter((i) => (i.shortsClassification ?? i.kind) === 'video'), [items]);
  const shorts = useMemo(() => items.filter((i) => (i.shortsClassification ?? i.kind) === 'short'), [items]);
  const live = useMemo(() => items.filter((i) => (i.shortsClassification ?? i.kind) === 'live'), [items]);
  const unclassified = useMemo(() => items.filter((i) => i.shortsClassification === 'unclassified'), [items]);

  const renderGroup = (title: string, list: FeedItem[], variant: 'row' | 'short') => {
    if (list.length === 0) return null;
    const byDay = new Map<string, FeedItem[]>();
    for (const it of list) {
      const arr = byDay.get(it.dayGroup) ?? [];
      arr.push(it);
      byDay.set(it.dayGroup, arr);
    }
    return (
      <section className="space-y-2.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {title} ({list.length})
        </h2>
        {[...byDay.entries()].map(([day, dayItems]) => (
          <div key={day} className="space-y-2">
            <div className="text-[11px] font-medium text-[var(--text-secondary)]">{day}</div>
            <div className={variant === 'short' ? 'grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4' : 'space-y-2'}>
              {dayItems.map((it) => (
                <FeedItemCard
                  key={it.id}
                  item={it}
                  variant={variant}
                  focused={items[focusedIdx]?.id === it.id}
                  selected={selectedIds.has(it.id)}
                  copied={copiedId === it.id}
                  follow={sourceByAccount.get(it.accountId)}
                  onToggleSelect={(id) =>
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  onOpenDetail={setDetailItemId}
                  onCopyUrl={(id, u) => {
                    const safe = safeExternalUrl(u);
                    if (safe) {
                      void navigator.clipboard.writeText(safe);
                      setCopiedId(id);
                      window.setTimeout(() => setCopiedId(null), 1500);
                    }
                  }}
                  onToggleStar={(fid, starred) => starMutation.mutate({ followId: fid, starred })}
                  onClaim={(id, t) => setClaimTarget({ id, title: t })}
                  onUnclaim={(cid) => unclaimMutation.mutate(cid)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
    );
  };

  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Discover Feed</h1>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Videos, Shorts, and Live streams with saved views and shortcuts (<kbd className="kbd">?</kbd>).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => seenMutation.mutate({ all: true })}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] text-[var(--text-primary)]"
            >
              <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
              Mark all seen
            </button>
            <button
              type="button"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-tint)] px-3 text-[12px] font-medium text-[var(--text-strong)]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              Sync Now
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {([['', 'All'], ['youtube', 'YouTube'], ['twitch', 'Twitch'], ['kick', 'Kick']] as const).map(([p, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setPlatform(p)}
              className={`min-h-[36px] rounded-lg border px-3 text-[12px] font-medium ${
                platform === p
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {unconfiguredSelected && (
          <Card className="flex items-center justify-between gap-3 p-4">
            <span className="text-[12px] text-[var(--text-secondary)]">
              Connect {platform} credentials in Settings &rarr; Integrations to ingest items.
            </span>
            <Link to="/settings" className="text-[12px] font-medium text-[var(--accent)]">
              Connect {platform}
            </Link>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['', `All Lanes (${laneCounts.videos + laneCounts.shorts + laneCounts.live + laneCounts.unclassified})`],
              ['videos', `Videos (${laneCounts.videos})`],
              ['shorts', `Shorts (${laneCounts.shorts})`],
              ['live', `Live & Premieres (${laneCounts.live})`],
              ...(laneCounts.unclassified > 0 ? [['unclassified', `Unclassified (${laneCounts.unclassified})`] as const] : []),
            ] as const
          ).map(([l, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setLane(l)}
              className={`min-h-[34px] rounded-full border px-3 text-[11px] font-medium ${
                lane === l
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {creatorsRail.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setAccountId('')}
              className={`min-h-[34px] shrink-0 rounded-full border px-3 text-[11px] ${
                !accountId
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
              }`}
            >
              All Creators
            </button>
            {creatorsRail.map((c) => (
              <button
                key={c.accountId}
                type="button"
                onClick={() => setAccountId((prev) => (prev === c.accountId ? '' : c.accountId))}
                className={`inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] ${
                  accountId === c.accountId
                    ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
                }`}
              >
                <span>{c.displayName || normalizeHandle(c.handle)}</span>
                {c.unseenCount > 0 && (
                  <span className="rounded-full bg-[var(--surface-2)] px-1.5 text-[10px] text-[var(--accent)]">
                    {c.unseenCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <Card className="flex flex-wrap items-center gap-2 p-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter titles..."
            aria-label="Filter feed titles"
            className="min-h-[38px] min-w-[160px] flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px] text-[var(--text-primary)]"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as FeedSort)} aria-label="Sort feed" className="min-h-[38px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-2.5 text-[12px]">
            <option value="newest">Newest</option>
            <option value="rising">Rising</option>
            <option value="views">Most Views</option>
          </select>
          <select value={age} onChange={(e) => setAge(e.target.value as FeedAge | '')} aria-label="Filter age" className="min-h-[38px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-2.5 text-[12px]">
            <option value="">Any age</option>
            <option value="6h">6h</option>
            <option value="24h">24h</option>
            <option value="72h">72h</option>
            <option value="7d">7d</option>
          </select>
          <button type="button" onClick={() => setUnseenOnly((v) => !v)} className={`min-h-[38px] rounded-lg border px-2.5 text-[12px] ${unseenOnly ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]' : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]'}`}>
            Unseen
          </button>
          <button type="button" onClick={() => setStarredOnly((v) => !v)} className={`min-h-[38px] rounded-lg border px-2.5 text-[12px] ${starredOnly ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]' : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]'}`}>
            Starred
          </button>
          <input
            type="text"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="Save view..."
            aria-label="New saved view name"
            className="min-h-[38px] w-32 rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-2.5 text-[12px]"
          />
          <button
            type="button"
            disabled={!viewName.trim() || saveViewMutation.isPending}
            onClick={() => saveViewMutation.mutate()}
            aria-label="Save current view"
            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[12px] disabled:opacity-40"
          >
            <BookmarkPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Save
          </button>
        </Card>

        {(viewsQuery.data ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(viewsQuery.data ?? []).map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setPlatform(v.filters.platform ?? '');
                    setLane(v.filters.lane ?? '');
                    setSort(v.filters.sort ?? 'newest');
                    setAge(v.filters.age ?? '');
                    setUnseenOnly(Boolean(v.filters.unseenOnly));
                    setStarredOnly(Boolean(v.filters.starredOnly));
                    setAccountId(v.filters.accountId ?? '');
                    setSearch(v.filters.q ?? '');
                  }}
                  className="text-[var(--text-primary)] hover:text-[var(--accent)]"
                >
                  {v.name}
                </button>
                <button type="button" aria-label={`Delete view ${v.name}`} onClick={() => deleteViewMutation.mutate(v.id)} className="text-[var(--text-muted)] hover:text-[var(--danger)]">
                  <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </span>
            ))}
          </div>
        )}

        {selectedIds.size > 0 && (
          <Card className="flex items-center justify-between p-3 text-[12px]">
            <span>{selectedIds.size} selected</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => seenMutation.mutate({ itemIds: [...selectedIds] })} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-semibold text-[#0c1519]">
                Mark Seen
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="rounded-lg border border-[var(--border)] px-3 py-1.5">
                Clear
              </button>
            </div>
          </Card>
        )}

        {toastMsg && (
          <div role="status" className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[12px]">
            <span>{toastMsg}</span>
            <button type="button" onClick={() => setToastMsg(null)} className="text-[var(--accent)]">Dismiss</button>
          </div>
        )}

        {shortcutsOpen && (
          <Card className="p-3 text-[12px] text-[var(--text-secondary)]">
            Shortcuts: <kbd className="kbd">J</kbd>/<kbd className="kbd">K</kbd> focus · <kbd className="kbd">O</kbd> detail · <kbd className="kbd">C</kbd> claim · <kbd className="kbd">S</kbd> star · <kbd className="kbd">X</kbd> select
          </Card>
        )}

        {feedQuery.isLoading ? (
          <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading feed...</Card>
        ) : items.length === 0 ? (
          <EmptyState icon={Rss} title="No feed items match your filters" description="Adjust filters or sync creators to populate Discover." />
        ) : lane ? (
          renderGroup(
            lane === 'shorts' ? 'Shorts' : lane === 'live' ? 'Live & Premieres' : lane === 'unclassified' ? 'Unclassified' : 'Videos',
            items,
            lane === 'shorts' ? 'short' : 'row',
          )
        ) : (
          <div className="space-y-6">
            {renderGroup('Videos', videos, 'row')}
            {renderGroup('Shorts', shorts, 'short')}
            {renderGroup('Live & Premieres', live, 'row')}
            {renderGroup('Unclassified', unclassified, 'row')}
          </div>
        )}

        {feedQuery.hasNextPage && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => void feedQuery.fetchNextPage()}
              disabled={feedQuery.isFetchingNextPage}
              className="min-h-[44px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 text-[12px] font-medium"
            >
              {feedQuery.isFetchingNextPage ? 'Loading more...' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      <ItemDetailDrawer
        itemId={detailItemId}
        onClose={() => setDetailItemId(null)}
        onClaim={(id, title) => setClaimTarget({ id, title })}
      />

      {claimTarget && (
        <ClaimModal itemId={claimTarget.id} itemTitle={claimTarget.title} onClose={() => setClaimTarget(null)} />
      )}
    </div>
  );
}
