import { useNavigate } from '@tanstack/react-router';
import { RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Kbd } from '../ui/Kbd';
import { NAV_ITEMS } from './nav';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onRefreshHealth: () => void;
}

interface PaletteEntry {
  id: string;
  label: string;
  subtitle: string;
  run: () => void;
}

export function CommandPalette({ open, onClose, onRefreshHealth }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<PaletteEntry[]>(() => {
    const routeEntries: PaletteEntry[] = NAV_ITEMS.map((item) => ({
      id: `route:${item.to}`,
      label: item.label,
      subtitle: item.section,
      run: () => {
        void navigate({ to: item.to });
        onClose();
      },
    }));

    return [
      ...routeEntries,
      {
        id: 'action:refresh-health',
        label: 'Refresh system status',
        subtitle: 'Check Edge & providers now',
        run: () => {
          onRefreshHealth();
          onClose();
        },
      },
    ];
  }, [navigate, onClose, onRefreshHealth]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        entry.label.toLowerCase().includes(q) || entry.subtitle.toLowerCase().includes(q),
    );
  }, [entries, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length,
      );
      return;
    }
    if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].run();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]"
      onKeyDown={handleKeyDown}
    >
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center gap-2.5 border-b border-[var(--divider)] px-3.5 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" strokeWidth={1.5} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Navigate to a route or run an action..."
            aria-label="Filter commands"
            className="w-full bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <ul className="max-h-72 overflow-y-auto p-1.5" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">
              No matching routes or actions.
            </li>
          ) : (
            filtered.map((entry, idx) => {
              const selected = idx === selectedIndex;
              return (
                <li key={entry.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={entry.run}
                    className={`flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 text-left text-[13px] ${
                      selected
                        ? 'bg-[var(--accent-tint)] text-[var(--text-strong)]'
                        : 'text-[var(--text-primary)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {entry.id.startsWith('action:') && (
                        <RefreshCw
                          className="h-3.5 w-3.5 text-[var(--accent)]"
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                      )}
                      <span>{entry.label}</span>
                    </span>
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      {entry.subtitle}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex items-center justify-between border-t border-[var(--divider)] bg-[var(--surface-2)] px-3.5 py-2 text-[11px] text-[var(--text-muted)]">
          <span className="flex items-center gap-2">
            <Kbd keys={['↑', '↓']} /> to move · <Kbd keys={['Enter']} /> to open
          </span>
          <Kbd keys={['Esc']} />
        </div>
      </div>
    </div>
  );
}
