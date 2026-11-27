import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Scissors, X } from 'lucide-react';
import { fetchItemDetail } from '../../lib/api-v1';
import {
  formatAgeSeconds,
  formatCount,
  formatHumanDuration,
  formatProvenance,
  formatSecToMmSs,
  normalizeHandle,
  safeExternalUrl,
  safeThumbnailUrl,
} from '../../lib/url';

interface ItemDetailDrawerProps {
  itemId: string | null;
  onClose: () => void;
  onClaim: (itemId: string, title: string) => void;
}

export function ItemDetailDrawer({ itemId, onClose, onClaim }: ItemDetailDrawerProps) {
  const detailQuery = useQuery({
    queryKey: ['item-detail', itemId],
    queryFn: () => fetchItemDetail(itemId ?? ''),
    enabled: Boolean(itemId),
  });

  if (!itemId) return null;

  const data = detailQuery.data;
  const item = data?.item;
  const thumb = safeThumbnailUrl(item?.thumbnailUrl);
  const extUrl = item ? safeExternalUrl(item.url) : null;

  return (
    <aside
      aria-label="Item detail"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--surface)] xl:static xl:z-auto xl:w-[380px] xl:shrink-0 xl:rounded-xl xl:border"
    >
      <div className="flex items-center justify-between border-b border-[var(--divider)] px-4 py-3">
        <span className="text-[13px] font-semibold text-[var(--text-strong)]">Item Detail</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail drawer"
          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {detailQuery.isLoading ? (
          <p className="text-[12px] text-[var(--text-secondary)]">Loading item detail...</p>
        ) : detailQuery.isError || !item ? (
          <p className="text-[12px] text-[var(--danger)]">Failed to load item details.</p>
        ) : (
          <>
            {thumb && (
              <div className="aspect-video overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                <img
                  src={thumb}
                  alt={item.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
            )}

            <div>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 uppercase text-[var(--text-secondary)]">
                  {item.platform}
                </span>
                <span className="text-[var(--text-primary)]">
                  {item.accountDisplayName || normalizeHandle(item.accountHandle)}
                </span>
                <span className="text-[var(--text-muted)]">
                  {formatProvenance(item.source, item.platform)} · {formatAgeSeconds(item.ageSeconds)}
                </span>
              </div>
              <h2 className="mt-1.5 text-[15px] font-semibold text-[var(--text-strong)]">
                {item.title}
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px]">
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Views</div>
                <div className="font-mono text-[var(--text-strong)]">
                  {formatCount(item.latestViews)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Duration</div>
                <div className="font-mono text-[var(--text-strong)]">
                  {formatHumanDuration(item.durationSec)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Likes</div>
                <div className="font-mono text-[var(--text-strong)]">
                  {formatCount(item.latestLikes)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Comments</div>
                <div className="font-mono text-[var(--text-strong)]">
                  {formatCount(item.latestComments)}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onClaim(item.id, item.title)}
                className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-[#0c1519]"
              >
                <Scissors className="h-3.5 w-3.5" strokeWidth={1.8} />
                Claim / Range
              </button>
              {extUrl && (
                <a
                  href={extUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] font-medium text-[var(--text-primary)]"
                >
                  Open
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                </a>
              )}
            </div>

            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Claims ({data.claims.length})
              </h3>
              {data.claims.length === 0 ? (
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">No claims yet.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {data.claims.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12px]"
                    >
                      <span className="font-semibold text-[var(--accent)]">{c.status}</span>
                      <span className="font-mono text-[var(--text-secondary)]">
                        {c.startSec !== null && c.endSec !== null
                          ? `${formatSecToMmSs(c.startSec)} – ${formatSecToMmSs(c.endSec)}`
                          : 'Whole item'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {data.alerts.length > 0 && (
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Signals ({data.alerts.length})
                </h3>
                <div className="mt-2 space-y-1.5">
                  {data.alerts.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5 text-[12px]"
                    >
                      <div className="font-semibold text-[var(--text-strong)]">
                        {a.type} ({a.confidence})
                      </div>
                      <div className="mt-0.5 text-[var(--text-secondary)]">{a.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
