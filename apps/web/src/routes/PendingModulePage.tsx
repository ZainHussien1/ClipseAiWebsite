import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { NAV_ITEMS, type NavItem } from '../components/shell/nav';
import { EmptyState } from '../components/ui/EmptyState';

interface PendingModulePageProps {
  path: NavItem['to'];
}

export function PendingModulePage({ path }: PendingModulePageProps) {
  const item = NAV_ITEMS.find((entry) => entry.to === path) ?? NAV_ITEMS[0];
  if (!item) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {item.section}
          </div>
          <h1 className="mt-0.5 text-[18px] font-semibold text-[var(--text-strong)]">
            {item.label}
          </h1>
        </div>
        <Link
          to="/"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--input-border)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          Back to Overview
        </Link>
      </div>

      <EmptyState
        icon={item.icon}
        badge={item.phaseLabel}
        title={`${item.label} is not active in Phase 1`}
        description={`${item.description} No placeholder or demo data is displayed before real backend endpoints are connected.`}
      />
    </div>
  );
}
