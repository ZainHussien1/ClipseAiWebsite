import { Check, Copy, ExternalLink, PanelRightOpen, Scissors, Star } from 'lucide-react';
import type { FeedItem, SourceItem } from '../../lib/contracts';
import {
  formatAgeSeconds,
  formatCount,
  formatHumanDuration,
  formatLatencyMs,
  formatProvenance,
  normalizeHandle,
  safeExternalUrl,
  safeThumbnailUrl,
} from '../../lib/url';
import { Card } from './Card';

interface FeedItemCardProps {
  item: FeedItem;
  variant: 'row' | 'short';
  focused: boolean;
  selected: boolean;
  copied: boolean;
  follow: SourceItem | undefined;
  onToggleSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onCopyUrl: (id: string, url: string) => void;
  onToggleStar: (followId: string, starred: boolean) => void;
  onClaim: (id: string, title: string) => void;
  onUnclaim: (claimId: string) => void;
}

export function FeedItemCard({
  item,
  variant,
  focused,
  selected,
  copied,
  follow,
  onToggleSelect,
  onOpenDetail,
  onCopyUrl,
  onToggleStar,
  onClaim,
  onUnclaim,
}: FeedItemCardProps) {
  const extUrl = safeExternalUrl(item.url);
  const thumb = safeThumbnailUrl(item.thumbnailUrl);
  const claim = item.claim;

  return (
    <Card
      className={`p-3 ${
        focused ? 'border-[var(--accent)]' : ''
      } ${variant === 'short' ? 'flex flex-col justify-between gap-2.5' : ''}`}
    >
      <div className={variant === 'short' ? 'space-y-2.5' : 'flex flex-wrap items-start gap-3'}>
        <div className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(item.id)}
            aria-label={`Select ${item.title}`}
            className="mt-1 h-4 w-4 accent-[var(--accent)]"
          />
          {thumb && (
            <button
              type="button"
              onClick={() => onOpenDetail(item.id)}
              className={`overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] ${
                variant === 'short' ? 'aspect-[9/16] w-full' : 'aspect-video w-36 shrink-0'
              }`}
            >
              <img
                src={thumb}
                alt={item.title}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {!item.isSeen && (
              <span
                className="h-2 w-2 rounded-full bg-[var(--accent)]"
                title="Unseen"
                aria-label="Unseen item"
              />
            )}
            <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-semibold uppercase text-[var(--text-secondary)]">
              {item.platform}
            </span>
            <span className="font-medium text-[var(--text-primary)]">
              {item.accountDisplayName || normalizeHandle(item.accountHandle)}
            </span>
            {claim && (
              <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                {claim.status} by {claim.claimedByMe ? 'you' : (claim.email ?? 'teammate')}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => onOpenDetail(item.id)}
            className="mt-1 block text-left text-[13.5px] font-semibold text-[var(--text-strong)] hover:text-[var(--accent)]"
          >
            <span className={variant === 'short' ? 'line-clamp-2' : 'line-clamp-2'}>
              {item.title}
            </span>
          </button>

          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
            <span>Views: {formatCount(item.latestViews)}</span>
            <span>Likes: {formatCount(item.latestLikes)}</span>
            <span>Duration: {formatHumanDuration(item.durationSec)}</span>
            <span>
              {item.isBackfill ? 'Backfilled' : `First seen: ${formatLatencyMs(item.ingestLatencyMs)}`}
            </span>
            <span>
              {formatProvenance(item.source, item.platform)} · {formatAgeSeconds(item.ageSeconds)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {follow && (
            <button
              type="button"
              aria-label={follow.starred ? 'Unstar creator' : 'Star creator'}
              onClick={() => onToggleStar(follow.followId, !follow.starred)}
              className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border ${
                follow.starred
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
              }`}
            >
              <Star className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenDetail(item.id)}
            aria-label="Open item detail"
            className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
          {extUrl && (
            <>
              <a
                href={extUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open source link"
                className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
              </a>
              <button
                type="button"
                onClick={() => onCopyUrl(item.id, extUrl)}
                aria-label="Copy source link"
                className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-[var(--success)]" strokeWidth={1.5} />
                ) : (
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
              </button>
            </>
          )}
          {claim ? (
            claim.claimedByMe ? (
              <button
                type="button"
                onClick={() => onUnclaim(claim.id)}
                className="min-h-[38px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
              >
                Unclaim
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="min-h-[38px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] text-[var(--text-muted)] opacity-60"
              >
                Claimed
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => onClaim(item.id, item.title)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-[#0c1519]"
            >
              <Scissors className="h-3.5 w-3.5" strokeWidth={1.8} />
              Claim
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
