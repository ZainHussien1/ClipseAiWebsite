import type { SystemStatus } from '../../lib/api';
import { useRelativeAge } from '../../lib/useRelativeAge';

interface StatusPillProps {
  status: SystemStatus;
  fetchedAtMs: number | null | undefined;
  source: string;
  compact?: boolean;
}

const STATUS_STYLE: Record<
  SystemStatus,
  { label: string; bg: string; color: string; dot: string }
> = {
  synced: {
    label: 'Synced',
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

export function StatusPill({ status, fetchedAtMs, source, compact = false }: StatusPillProps) {
  const age = useRelativeAge(fetchedAtMs);
  const style = STATUS_STYLE[status];

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[12px] font-medium"
      style={{
        backgroundColor: style.bg,
        color: style.color,
        border: '1px solid var(--border)',
      }}
      title={`Source: ${source} • Checked ${age}`}
      aria-live="polite"
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: style.dot }}
        aria-hidden="true"
      />
      <span>{style.label}</span>
      {!compact && (
        <span className="hidden text-[11px] opacity-80 sm:inline">
          · {source} · {age}
        </span>
      )}
    </div>
  );
}
