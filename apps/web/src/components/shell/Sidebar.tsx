import { Link, useRouterState } from '@tanstack/react-router';
import type { HealthSnapshot } from '../../lib/api';
import { NAV_ITEMS, type NavItem, type NavSection } from './nav';

interface SidebarProps {
  health: HealthSnapshot | undefined;
}

const SECTIONS: NavSection[] = ['WORKSPACE', 'LIVE MODULE'];

function BrandMark() {
  return (
    <div className="flex h-12 items-center gap-2.5 border-b border-[var(--divider)] px-4">
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-tint)] text-[var(--accent)]">
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="14" height="14" rx="4" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="10" cy="10" r="2.5" fill="currentColor" />
        </svg>
      </div>
      <span className="text-[13px] font-semibold tracking-tight text-[var(--text-strong)]">
        clipse
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
        radar
      </span>
    </div>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={`flex min-h-[44px] items-center justify-between rounded-lg px-3 text-[13px] font-medium transition-colors ${
        active
          ? 'bg-[var(--accent-tint)] text-[var(--text-strong)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span className="flex items-center gap-2.5">
        <Icon
          className="h-4 w-4 shrink-0"
          strokeWidth={1.5}
          style={{ color: active ? 'var(--accent)' : 'currentColor' }}
          aria-hidden="true"
        />
        <span>{item.label}</span>
      </span>
      {item.badge && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider"
          style={{
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
          }}
        >
          {item.badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({ health }: SidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside
      aria-label="Primary navigation"
      className="hidden w-[232px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)] md:flex"
    >
      <BrandMark />
      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
        {SECTIONS.map((section) => {
          const items = NAV_ITEMS.filter((item) => item.section === section);
          return (
            <div key={section}>
              <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                {section}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <SidebarLink
                    key={item.to}
                    item={item}
                    active={pathname === item.to}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-[var(--divider)] px-4 py-3 text-[11px] text-[var(--text-muted)]">
        <div className="flex items-center justify-between">
          <span>Environment</span>
          <span className="font-mono text-[var(--text-secondary)]">
            {health?.environment ?? 'unknown'}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span>Build</span>
          <span className="text-[var(--text-secondary)]">Phase 1 Shell</span>
        </div>
      </div>
    </aside>
  );
}
