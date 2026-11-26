import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, badge, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--dashed)] bg-[var(--surface)] px-6 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]">
        <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
      </div>
      {badge && (
        <span className="mb-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
          {badge}
        </span>
      )}
      <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">{title}</h2>
      <p className="mt-1 max-w-md text-[12px] text-[var(--text-secondary)]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
