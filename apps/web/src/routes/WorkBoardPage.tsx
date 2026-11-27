import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, KanbanSquare, Scissors } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { fetchMe } from '../lib/api';
import { ApiError, claimFromAlert, fetchWorkBoard, updateClaim } from '../lib/api-v1';
import type { ClaimStatus, WorkBoardClaim } from '../lib/contracts';
import { formatSecToMmSs, normalizeHandle, safeExternalUrl, safeThumbnailUrl } from '../lib/url';

const BOARD_STATUSES: ClaimStatus[] = ['Claimed', 'Clipping', 'Clipped', 'Published'];

export function WorkBoardPage({ mineOnly = false }: { mineOnly?: boolean }) {
  const queryClient = useQueryClient();
  const [showSkipped, setShowSkipped] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [clipUrls, setClipUrls] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const boardQuery = useQuery({ queryKey: ['work-board'], queryFn: fetchWorkBoard });
  const meQuery = useQuery({ queryKey: ['system', 'me'], queryFn: fetchMe, enabled: mineOnly });

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${proto}//${window.location.host}/api/v1/ws`);
      socket.onmessage = () => {
        if (!closed) void queryClient.invalidateQueries({ queryKey: ['work-board'] });
      };
    } catch {
      // fallback to query invalidation on mutation
    }
    return () => {
      closed = true;
      socket?.close();
    };
  }, [queryClient]);

  const claimHotMutation = useMutation({
    mutationFn: claimFromAlert,
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['work-board'] });
    },
    onError: (err) => setErrorMsg(err instanceof ApiError ? err.message : 'Failed to claim alert'),
  });

  const moveMutation = useMutation({
    mutationFn: ({ claimId, status, clipUrl }: { claimId: string; status: ClaimStatus; clipUrl?: string }) =>
      updateClaim(claimId, { status, ...(clipUrl ? { clipUrl } : {}) }),
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['work-board'] });
    },
    onError: (err) => setErrorMsg(err instanceof ApiError ? err.message : 'Failed to update claim'),
  });

  const visibleClaims = useMemo(() => {
    const all = boardQuery.data?.claims ?? [];
    const myEmail = meQuery.data?.email;
    return mineOnly && myEmail ? all.filter((c) => c.claimerEmail === myEmail) : all;
  }, [boardQuery.data?.claims, mineOnly, meQuery.data?.email]);

  const columns: ClaimStatus[] = showSkipped ? [...BOARD_STATUSES, 'Skipped'] : BOARD_STATUSES;
  const hotUnclaimed = boardQuery.data?.hotUnclaimed ?? [];

  const moveCard = (card: WorkBoardClaim, targetStatus: ClaimStatus) => {
    const enteredUrl = (clipUrls[card.id] ?? '').trim();
    moveMutation.mutate({
      claimId: card.id,
      status: targetStatus,
      ...(enteredUrl.startsWith('https://') ? { clipUrl: enteredUrl } : {}),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">
            {mineOnly ? 'My Work' : 'Work Board'}
          </h1>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Drag cards or use column arrows to track edits from Claimed through Published.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSkipped((v) => !v)}
          className={`min-h-[38px] rounded-lg border px-3 text-[12px] font-medium ${
            showSkipped
              ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
              : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
          }`}
        >
          {showSkipped ? 'Hide Skipped' : 'Show Skipped'}
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-[12px]"
          style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
        >
          {errorMsg}
        </div>
      )}

      {boardQuery.isLoading ? (
        <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading work board...</Card>
      ) : visibleClaims.length === 0 && hotUnclaimed.length === 0 ? (
        <EmptyState
          icon={KanbanSquare}
          title={mineOnly ? 'No claims assigned to you' : 'Work Board is clear'}
          description="Claim an item or time range from Discover Feed or Alerts to track production here."
        />
      ) : (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 lg:grid lg:grid-cols-5 lg:overflow-visible">
          {!mineOnly && (
            <div className="min-w-[270px] snap-start rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 lg:min-w-0">
              <div className="mb-2.5 flex items-center justify-between text-[12px] font-semibold text-[var(--text-strong)]">
                <span>Hot Unclaimed</span>
                <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[11px] text-[var(--accent)]">
                  {hotUnclaimed.length}
                </span>
              </div>
              <div className="space-y-2">
                {hotUnclaimed.map((h) => {
                  const thumb = safeThumbnailUrl(h.thumbnailUrl);
                  return (
                    <div key={h.alertId} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5 text-[12px]">
                      {thumb && (
                        <div className="mb-2 aspect-video overflow-hidden rounded bg-[var(--bg)]">
                          <img src={thumb} alt={h.title} loading="lazy" className="h-full w-full object-cover" />
                        </div>
                      )}
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {h.platform.toUpperCase()} · {h.creatorName || normalizeHandle(h.creatorHandle)}
                      </div>
                      <div className="mt-1 line-clamp-2 font-semibold text-[var(--text-strong)]">{h.title}</div>
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">{h.reason}</div>
                      <button
                        type="button"
                        onClick={() => claimHotMutation.mutate(h.alertId)}
                        className="mt-2 inline-flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-[11px] font-semibold text-[#0c1519]"
                      >
                        <Scissors className="h-3.5 w-3.5" strokeWidth={1.8} />
                        Claim
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {columns.map((colStatus, colIdx) => {
            const cards = visibleClaims.filter((c) => c.status === colStatus);
            return (
              <div
                key={colStatus}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!draggedId) return;
                  const card = visibleClaims.find((c) => c.id === draggedId);
                  if (card && card.status !== colStatus) moveCard(card, colStatus);
                  setDraggedId(null);
                }}
                className="min-w-[270px] snap-start rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 lg:min-w-0"
              >
                <div className="mb-2.5 flex items-center justify-between text-[12px] font-semibold text-[var(--text-strong)]">
                  <span>{colStatus}</span>
                  <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                    {cards.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {cards.map((card) => {
                    const thumb = safeThumbnailUrl(card.thumbnailUrl);
                    const extUrl = safeExternalUrl(card.url);
                    const prevStatus = colIdx > 0 ? columns[colIdx - 1] : null;
                    const nextStatus = colIdx < columns.length - 1 ? columns[colIdx + 1] : null;
                    return (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={() => setDraggedId(card.id)}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5 text-[12px]"
                      >
                        {thumb && (
                          <div className="mb-2 aspect-video overflow-hidden rounded bg-[var(--bg)]">
                            <img src={thumb} alt={card.title} loading="lazy" className="h-full w-full object-cover" />
                          </div>
                        )}
                        <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                          <span>{card.platform.toUpperCase()} · {card.creatorName}</span>
                          {extUrl && (
                            <a href={extUrl} target="_blank" rel="noopener noreferrer" aria-label="Open item">
                              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </a>
                          )}
                        </div>
                        <div className="mt-1 line-clamp-2 font-semibold text-[var(--text-strong)]">{card.title}</div>
                        <div className="mt-1 font-mono text-[11px] text-[var(--accent)]">
                          {card.startSec !== null && card.endSec !== null
                            ? `${formatSecToMmSs(card.startSec)} – ${formatSecToMmSs(card.endSec)}`
                            : 'Whole item'}
                        </div>
                        {card.claimerEmail && (
                          <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{card.claimerEmail}</div>
                        )}
                        {(colStatus === 'Clipping' || colStatus === 'Clipped') && (
                          <input
                            type="url"
                            value={clipUrls[card.id] ?? card.clipUrl ?? ''}
                            onChange={(e) => setClipUrls((p) => ({ ...p, [card.id]: e.target.value }))}
                            placeholder="Clip URL (https://...)"
                            aria-label="Published clip URL"
                            className="mt-2 w-full rounded border border-[var(--input-border)] bg-[var(--input)] px-2 py-1 text-[11px]"
                          />
                        )}
                        <div className="mt-2 flex items-center justify-between gap-1">
                          <button
                            type="button"
                            disabled={!prevStatus}
                            onClick={() => prevStatus && moveCard(card, prevStatus)}
                            aria-label="Move to previous column"
                            className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded border border-[var(--border)] bg-[var(--surface)] disabled:opacity-30"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!nextStatus}
                            onClick={() => nextStatus && moveCard(card, nextStatus)}
                            aria-label="Move to next column"
                            className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded border border-[var(--border)] bg-[var(--surface)] disabled:opacity-30"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
