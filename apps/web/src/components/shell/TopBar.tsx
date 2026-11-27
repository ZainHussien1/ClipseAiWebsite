import { Link } from '@tanstack/react-router';
import { Bell, LogOut, Menu, RefreshCw, Search } from 'lucide-react';
import type { HealthSnapshot, SystemStatus } from '../../lib/api';
import { Kbd } from '../ui/Kbd';
import { StatusPill } from '../ui/StatusPill';

interface TopBarProps {
  status: SystemStatus;
  health: HealthSnapshot | undefined;
  unreadCount: number;
  showSignOut: boolean;
  isFetchingHealth: boolean;
  onRefreshHealth: () => void;
  onSignOut: () => void;
  onOpenCommandPalette: () => void;
  onOpenMobileDrawer: () => void;
}

export function TopBar({
  status,
  health,
  unreadCount,
  showSignOut,
  isFetchingHealth,
  onRefreshHealth,
  onSignOut,
  onOpenCommandPalette,
  onOpenMobileDrawer,
}: TopBarProps) {
  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)] px-3 py-1 sm:px-5">
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
          className="inline-flex min-h-[44px] items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] text-[var(--text-secondary)] hover:border-[var(--input-border)] hover:text-[var(--text-primary)]"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden sm:inline">Jump to route or action...</span>
          <span className="sm:hidden">Search</span>
          <span className="hidden sm:inline-flex">
            <Kbd keys={['Ctrl', 'K']} />
          </span>
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <StatusPill
          status={status}
          fetchedAtMs={health?.fetchedAtMs}
          lastIngestAt={health?.lastIngestAt}
          providers={health?.providers}
        />
        <Link
          to="/notifications"
          aria-label={`Notifications (${unreadCount} unread)`}
          className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
        >
          <Bell className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              className="absolute right-2 top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold"
              style={{ backgroundColor: 'var(--danger)', color: 'var(--text-strong)' }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={onRefreshHealth}
          aria-label="Refresh system status"
          disabled={isFetchingHealth}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${isFetchingHealth ? 'animate-spin' : ''}`}
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </button>
        {showSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        )}
      </div>
    </header>
  );
}
