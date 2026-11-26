import { WifiOff } from 'lucide-react';

interface OfflineBannerProps {
  visible: boolean;
  detail: string | null;
  onRetry: () => void;
}

export function OfflineBanner({ visible, detail, onRetry }: OfflineBannerProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2 text-[12px]"
      style={{
        backgroundColor: 'var(--danger-bg)',
        color: 'var(--danger)',
      }}
    >
      <div className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span>
          Offline mode — Edge API is unreachable
          {detail ? ` (${detail})` : ''}. Cached shell remains active.
        </span>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[32px] rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--input-border)]"
      >
        Retry
      </button>
    </div>
  );
}
