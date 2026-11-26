import { Menu, RefreshCw, Search } from 'lucide-react';
import type { HealthSnapshot, SystemStatus } from '../../lib/api';
import { Kbd } from '../ui/Kbd';
import { StatusPill } from '../ui/StatusPill';

interface TopBarProps {
  status: SystemStatus;
  health: HealthSnapshot | undefined;
  isFetchingHealth: boolean;
  onRefreshHealth: () => void;
  onOpenCommandPalette: () => void;
  onOpenMobileDrawer: () => void;
}

export function TopBar({
  status,
  health,
  isFetchingHealth,
  onRefreshHealth,
  onOpenCommandPalette,
  onOpenMobileDrawer,
}: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)] px-3 sm:px-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          aria-label="Open navigation menu"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] md:hidden"
        >
          <Menu className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="inline-flex min-h-[36px] items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] text-[var(--text-secondary)] hover:border-[var(--input-border)] hover:text-[var(--text-primary)]"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden sm:inline">Jump to route or action...</span>
          <span className="sm:hidden">Search</span>
          <span className="hidden sm:inline-flex">
            <Kbd keys={['Ctrl', 'K']} />
          </span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <StatusPill
          status={status}
          fetchedAtMs={health?.fetchedAtMs}
          source={health?.source ?? '/api/v1/health'}
        />
        <button
          type="button"
          onClick={onRefreshHealth}
          aria-label="Refresh health status"
          disabled={isFetchingHealth}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${isFetchingHealth ? 'animate-spin' : ''}`}
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </button>
      </div>
    </header>
  );
}
