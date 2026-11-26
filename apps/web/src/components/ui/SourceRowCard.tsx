import { Archive, Pause, Play, RefreshCw, Star } from 'lucide-react';
import type { SourceItem } from '../../lib/contracts';
import { formatAgeSeconds, formatProvenance, normalizeHandle } from '../../lib/url';
import { Card } from './Card';

interface SourceRowCardProps {
  src: SourceItem;
  onSync: (followId: string) => void;
  onPatch: (
    followId: string,
    patch: { starred?: boolean; paused?: boolean; archived?: boolean },
  ) => void;
}

export function SourceRowCard({ src, onSync, onPatch }: SourceRowCardProps) {
  const syncAgeSec = src.lastSyncedAt
    ? Math.floor((Date.now() - Date.parse(src.lastSyncedAt)) / 1000)
    : null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-secondary)]">
            {src.platform}
          </span>
          <span className="truncate text-[13px] font-semibold text-[var(--text-strong)]">
            {src.displayName || normalizeHandle(src.handle)}
          </span>
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            {normalizeHandle(src.handle)}
          </span>
          {src.groupName && (
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
              {src.groupName}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-[var(--text-muted)]">
          {formatProvenance(undefined, src.platform)} · Last synced:{' '}
          {syncAgeSec !== null ? formatAgeSeconds(syncAgeSec) : 'never'}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Sync source now"
          onClick={() => onSync(src.followId)}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[11px] text-[var(--text-primary)] hover:border-[var(--accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          Sync
        </button>
        <button
          type="button"
          aria-label={src.starred ? 'Unstar source' : 'Star source'}
          onClick={() => onPatch(src.followId, { starred: !src.starred })}
          className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border ${
            src.starred
              ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]'
              : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
          }`}
        >
          <Star className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label={src.paused ? 'Resume source' : 'Pause source'}
          onClick={() => onPatch(src.followId, { paused: !src.paused })}
          className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
        >
          {src.paused ? (
            <Play className="h-4 w-4" strokeWidth={1.5} />
          ) : (
            <Pause className="h-4 w-4" strokeWidth={1.5} />
          )}
        </button>
        <button
          type="button"
          aria-label={src.archived ? 'Restore source' : 'Archive source'}
          onClick={() => onPatch(src.followId, { archived: !src.archived })}
          className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--danger)]"
        >
          <Archive className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    </Card>
  );
}
