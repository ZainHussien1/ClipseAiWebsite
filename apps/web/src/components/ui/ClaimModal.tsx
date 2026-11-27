import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { ApiError, createClaim } from '../../lib/api-v1';
import { parseMmSsToSec } from '../../lib/url';

interface ClaimModalProps {
  itemId: string;
  itemTitle: string;
  onClose: () => void;
}

export function ClaimModal({ itemId, itemTitle, onClose }: ClaimModalProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'whole' | 'range'>('whole');
  const [startInput, setStartInput] = useState('0:00');
  const [endInput, setEndInput] = useState('1:00');
  const [note, setNote] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createClaim,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
      void queryClient.invalidateQueries({ queryKey: ['work-board'] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['rising'] });
      void queryClient.invalidateQueries({ queryKey: ['mission-control'] });
      onClose();
    },
    onError: (err) => {
      setErrorMsg(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to create claim',
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (mode === 'range') {
      const s = parseMmSsToSec(startInput);
      const en = parseMmSsToSec(endInput);
      if (s === null || en === null || en <= s) {
        setErrorMsg('Use mm:ss or seconds where end is greater than start (e.g. 0:45 – 1:30).');
        return;
      }
      mutation.mutate({
        itemId,
        startSec: s,
        endSec: en,
        note: note.trim() || undefined,
      });
      return;
    }

    mutation.mutate({
      itemId,
      note: note.trim() || undefined,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Claim item"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--divider)] pb-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">Claim Content</h2>
            <p className="mt-0.5 line-clamp-1 text-[12px] text-[var(--text-secondary)]">
              {itemTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close claim dialog"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('whole')}
              className={`min-h-[40px] flex-1 rounded-lg border px-3 text-[12px] font-medium ${
                mode === 'whole'
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                  : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]'
              }`}
            >
              Whole Item
            </button>
            <button
              type="button"
              onClick={() => setMode('range')}
              className={`min-h-[40px] flex-1 rounded-lg border px-3 text-[12px] font-medium ${
                mode === 'range'
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                  : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]'
              }`}
            >
              Range (mm:ss)
            </button>
          </div>

          {mode === 'range' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[12px] text-[var(--text-secondary)]">
                Start (mm:ss or sec)
                <input
                  type="text"
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  placeholder="0:30"
                  className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 font-mono text-[13px] text-[var(--text-primary)]"
                />
              </label>
              <label className="block text-[12px] text-[var(--text-secondary)]">
                End (mm:ss or sec)
                <input
                  type="text"
                  value={endInput}
                  onChange={(e) => setEndInput(e.target.value)}
                  placeholder="1:45"
                  className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 font-mono text-[13px] text-[var(--text-primary)]"
                />
              </label>
            </div>
          )}

          <label className="block text-[12px] text-[var(--text-secondary)]">
            Note (optional)
            <input
              type="text"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Angle, hook, or editor note..."
              className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </label>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-[12px]"
              style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
            >
              {errorMsg}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="min-h-[40px] rounded-lg bg-[var(--accent)] px-4 text-[12px] font-semibold text-[#0c1519] disabled:opacity-50"
          >
            {mutation.isPending ? 'Claiming...' : 'Confirm Claim'}
          </button>
        </div>
      </form>
    </div>
  );
}
