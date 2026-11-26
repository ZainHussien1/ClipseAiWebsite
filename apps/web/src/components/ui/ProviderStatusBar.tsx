import { useQuery } from '@tanstack/react-query';
import { fetchProviderStatus, type ProviderStatusEntry } from '../../lib/api-v1';

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  api_key_active: { bg: 'var(--success-bg)', color: 'var(--success)' },
  public_feed_active: { bg: 'var(--success-bg)', color: 'var(--success)' },
  ready: { bg: 'var(--success-bg)', color: 'var(--success)' },
  credentials_missing: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
};

function renderBadge(name: string, entry: ProviderStatusEntry | undefined) {
  const status = entry?.status ?? 'checking';
  const label = entry?.label ?? 'checking...';
  const colors = STATUS_COLORS[status] ?? {
    bg: 'var(--surface-2)',
    color: 'var(--text-secondary)',
  };

  return (
    <span
      key={name}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium"
      style={{ backgroundColor: colors.bg, color: colors.color }}
    >
      <span className="font-semibold">{name}:</span>
      <span>{label}</span>
    </span>
  );
}

export function ProviderStatusBar() {
  const statusQuery = useQuery({
    queryKey: ['providers', 'status'],
    queryFn: fetchProviderStatus,
    staleTime: 60_000,
  });

  const data = statusQuery.data;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Provider status">
      {renderBadge('YouTube', data?.youtube)}
      {renderBadge('Twitch', data?.twitch)}
      {renderBadge('Kick', data?.kick)}
    </div>
  );
}
