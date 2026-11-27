import { useState } from 'react';
import type { HealthProviderEntry, SystemStatus } from '../../lib/api';
import { formatAgeSeconds } from '../../lib/url';
import { useRelativeAge } from '../../lib/useRelativeAge';

interface StatusPillProps {
  status: SystemStatus;
  fetchedAtMs: number | null | undefined;
  lastIngestAt?: string | null;
  providers?: Record<string, HealthProviderEntry>;
  compact?: boolean;
}

const STATUS_STYLE: Record<
  SystemStatus,
  { label: string; bg: string; color: string; dot: string }
> = {
  synced: {
    label: 'System Healthy',
    bg: 'var(--success-bg)',
    color: 'var(--success)',
    dot: 'var(--success)',
  },
  degraded: {
    label: 'Degraded',
    bg: 'var(--warning-bg)',
    color: 'var(--warning)',
    dot: 'var(--warning)',
  },
  offline: {
    label: 'Offline',
    bg: 'var(--danger-bg)',
    color: 'var(--danger)',
    dot: 'var(--danger)',
  },
};

export function StatusPill({
  status,
  fetchedAtMs,
  lastIngestAt,
  providers,
  compact = false,
}: StatusPillProps) {
  const [open, setOpen] = useState(false);
  const checkedAge = useRelativeAge(fetchedAtMs);
  const style = STATUS_STYLE[status];

  const ingestAgeSec = lastIngestAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(lastIngestAt)) / 1000))
    : null;
  const ingestText =
    ingestAgeSec !== null && Number.isFinite(ingestAgeSec)
      ? formatAgeSeconds(ingestAgeSec)
      : 'no ingest yet';

  const providerList = Object.entries(providers ?? {});

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="System Status"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-3 py-1 text-[12px] font-medium"
        style={{
          backgroundColor: style.bg,
          color: style.color,
          border: '1px solid var(--border)',
        }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: style.dot }}
          aria-hidden="true"
        />
        <span>{style.label}</span>
        {!compact && (
          <span className="hidden text-[11px] opacity-85 sm:inline">
            · Last ingest: {ingestText}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="System Status Details"
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[12px]"
        >
          <div className="flex items-center justify-between border-b border-[var(--divider)] pb-2">
            <span className="font-semibold text-[var(--text-strong)]">System Status</span>
            <span className="text-[11px] text-[var(--text-muted)]">Checked {checkedAge}</span>
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">Last ingest</span>
              <span className="font-mono text-[var(--text-primary)]">{ingestText}</span>
            </div>
            {providerList.map(([name, info]) => (
              <div key={name} className="flex items-center justify-between">
                <span className="capitalize text-[var(--text-secondary)]">{name}</span>
                <span className="text-[var(--text-primary)]">{info.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
