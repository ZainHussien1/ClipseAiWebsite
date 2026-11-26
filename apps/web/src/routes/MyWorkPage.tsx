import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ApiError, listClaims, updateClaim } from '../lib/api-v1';
import type { ClaimRecord, ClaimStatus } from '../lib/contracts';

const STATUS_ACTIONS: ClaimStatus[] = ['Claimed', 'Clipped', 'Skipped'];

export function MyWorkPage() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<ClaimStatus | ''>('');
  const [actionError, setActionError] = useState<string | null>(null);

  const claimsQuery = useQuery({
    queryKey: ['claims'],
    queryFn: listClaims,
  });

  const transitionMutation = useMutation({
    mutationFn: ({ claimId, status }: { claimId: string; status: ClaimStatus }) =>
      updateClaim(claimId, { status }),
    onMutate: async ({ claimId, status }) => {
      setActionError(null);
      await queryClient.cancelQueries({ queryKey: ['claims'] });
      const previous = queryClient.getQueryData<ClaimRecord[]>(['claims']);
      queryClient.setQueryData<ClaimRecord[]>(['claims'], (old) =>
        old ? old.map((c) => (c.id === claimId ? { ...c, status } : c)) : old,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['claims'], context.previous);
      }
      setActionError(err instanceof ApiError ? err.message : 'Failed to update claim');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
    },
  });

  const visibleClaims = useMemo(() => {
    const all = claimsQuery.data ?? [];
    return filterStatus ? all.filter((c) => c.status === filterStatus) : all;
  }, [claimsQuery.data, filterStatus]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">My Work</h1>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Active item and time-range claims with optimistic status transitions.
          </p>
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as ClaimStatus | '')}
          aria-label="Filter claims by status"
          className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px] text-[var(--text-primary)]"
        >
          <option value="">All statuses</option>
          <option value="New">New</option>
          <option value="Claimed">Claimed</option>
          <option value="Clipped">Clipped</option>
          <option value="Skipped">Skipped</option>
        </select>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--border)] px-3.5 py-2.5 text-[12px]"
          style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
        >
          {actionError}
        </div>
      )}

      {claimsQuery.isLoading ? (
        <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading claims...</Card>
      ) : claimsQuery.isError ? (
        <Card className="p-5 text-[12px] text-[var(--danger)]">
          {claimsQuery.error instanceof Error ? claimsQuery.error.message : 'Failed to load claims'}
        </Card>
      ) : visibleClaims.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No active claims"
          description="Claim an item or time range from Feed, Live Now, or Rising to coordinate editing."
        />
      ) : (
        <div className="space-y-2.5">
          {visibleClaims.map((claim) => {
            const rangeLabel =
              claim.startSec !== null && claim.endSec !== null
                ? `${claim.startSec}s – ${claim.endSec}s`
                : 'Whole item';
            return (
              <Card key={claim.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full bg-[var(--accent-tint)] px-2.5 py-0.5 font-semibold text-[var(--accent)]">
                      {claim.status}
                    </span>
                    <span className="font-mono text-[var(--text-secondary)]">{rangeLabel}</span>
                    <span className="font-mono text-[var(--text-muted)]">
                      Item: {claim.itemId}
                    </span>
                  </div>
                  {claim.note && (
                    <p className="mt-1.5 text-[12px] text-[var(--text-primary)]">{claim.note}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {STATUS_ACTIONS.map((nextStatus) => (
                    <button
                      key={nextStatus}
                      type="button"
                      disabled={claim.status === nextStatus}
                      onClick={() =>
                        transitionMutation.mutate({ claimId: claim.id, status: nextStatus })
                      }
                      className={`min-h-[38px] rounded-lg border px-3 text-[12px] font-medium ${
                        claim.status === nextStatus
                          ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                          : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {nextStatus}
                    </button>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
