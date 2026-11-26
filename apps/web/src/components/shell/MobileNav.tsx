import { Link, useRouterState } from '@tanstack/react-router';
import { Menu, X } from 'lucide-react';
import { NAV_ITEMS } from './nav';

interface MobileNavProps {
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onOpenDrawer: () => void;
}

const PRIMARY_MOBILE_ROUTES = new Set(['/', '/feed', '/live', '/rising']);

export function MobileNav({ drawerOpen, onCloseDrawer, onOpenDrawer }: MobileNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const primaryItems = NAV_ITEMS.filter((item) => PRIMARY_MOBILE_ROUTES.has(item.to));

  return (
    <>
      <nav
        aria-label="Mobile quick navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-[var(--border)] bg-[var(--bg)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpenDrawer}
          className="flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
        >
          <Menu className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      {drawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation drawer"
          className="fixed inset-0 z-50 flex md:hidden"
        >
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseDrawer}
            aria-hidden="true"
          />
          <div className="relative z-10 flex w-72 max-w-[85vw] flex-col border-r border-[var(--border)] bg-[var(--bg)] p-3">
            <div className="mb-3 flex items-center justify-between border-b border-[var(--divider)] pb-2.5">
              <span className="text-[13px] font-semibold text-[var(--text-strong)]">
                Clipse Radar
              </span>
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label="Close navigation drawer"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface)]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={onCloseDrawer}
                    className={`flex min-h-[44px] items-center justify-between rounded-lg px-3 text-[13px] font-medium ${
                      active
                        ? 'bg-[var(--accent-tint)] text-[var(--text-strong)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--surface)]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon
                        className="h-4 w-4"
                        strokeWidth={1.5}
                        style={{ color: active ? 'var(--accent)' : 'currentColor' }}
                        aria-hidden="true"
                      />
                      <span>{item.label}</span>
                    </span>
                    {item.badge && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
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
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
