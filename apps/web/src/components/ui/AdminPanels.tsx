import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import {
  ApiError,
  fetchAdminHealth,
  fetchAuditLog,
  fetchDataQuality,
  retryAdminDlq,
} from '../../lib/api-v1';
import { Card } from './Card';

export function AdminHealthPanel() {
  const queryClient = useQueryClient();
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const healthQuery = useQuery({ queryKey: ['admin', 'health'], queryFn: fetchAdminHealth, retry: false });

  const retryMutation = useMutation({
    mutationFn: retryAdminDlq,
    onSuccess: (res) => {
      setRetryMsg(`Retried ${res.retriedCount} item(s). Pending: ${res.remainingPending}`);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'health'] });
    },
    onError: (err) => setRetryMsg(err instanceof ApiError ? err.message : 'Retry failed'),
  });

  if (healthQuery.isLoading) return <Card className="p-6 text-[12px]">Loading admin health...</Card>;
  if (healthQuery.isError || !healthQuery.data) {
    return (
      <Card className="p-5 text-[12px] text-[var(--danger)]">
        {healthQuery.error instanceof Error ? healthQuery.error.message : 'Requires Admin role.'}
      </Card>
    );
  }

  const d = healthQuery.data;
  const readPct = Math.min(100, Math.round((d.d1.readsTodayEstimate / d.d1.dailyReadLimit) * 100));
  const writePct = Math.min(100, Math.round((d.d1.writesTodayEstimate / d.d1.dailyWriteLimit) * 100));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">D1 Reads / Writes Today</div>
          <div className="mt-1 font-mono text-[13px] text-[var(--text-strong)]">
            {d.d1.readsTodayEstimate.toLocaleString()} ({readPct}%) /{' '}
            {d.d1.writesTodayEstimate.toLocaleString()} ({writePct}%)
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
            {d.d1.degraded ? 'Degraded (near free ceiling)' : 'Within free-tier limits'}
          </div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Queues &amp; DLQs</div>
          <div className="mt-1 font-mono text-[13px] text-[var(--text-strong)]">
            DLQ: {d.queues.ingestDlqCount} ingest · {d.queues.notifyDlqCount} notify
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
            Pending items: {d.queues.dlqItems.length}
          </div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Cron &amp; Reconcile</div>
          <div className="mt-1 font-mono text-[13px] text-[var(--text-strong)]">
            {d.cron.reconcileRunsToday} runs today
          </div>
          <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
            Last: {d.cron.lastRunAt ?? 'never'}
          </div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Delivery Success</div>
          <div className="mt-1 font-mono text-[13px] text-[var(--text-strong)]">
            {d.delivery.successRate !== null
              ? `${(d.delivery.successRate * 100).toFixed(1)}%`
              : 'n/a'}
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
            {d.delivery.deliveredCount} ok · {d.delivery.failedCount} fail ·{' '}
            {d.delivery.suppressedCount} supp
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-[var(--text-strong)]">
            Dead-Letter Queue ({d.queues.dlqItems.length})
          </h3>
          {d.queues.dlqItems.length > 0 && (
            <button
              type="button"
              disabled={retryMutation.isPending}
              onClick={() => retryMutation.mutate({})}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-tint)] px-3 text-[11px] font-medium"
            >
              <RefreshCw className="h-3 w-3" />
              Retry All Pending
            </button>
          )}
        </div>
        {retryMsg && <p className="mt-2 text-[12px] text-[var(--accent)]">{retryMsg}</p>}
        {d.queues.dlqItems.length === 0 ? (
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">No DLQ items pending.</p>
        ) : (
          <div className="mt-2 space-y-1.5 text-[12px]">
            {d.queues.dlqItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
              >
                <div>
                  <span className="font-mono text-[var(--warning)]">{item.queueName}</span> ·{' '}
                  <span>{item.errorReason}</span>
                </div>
                <button
                  type="button"
                  onClick={() => retryMutation.mutate({ id: item.id })}
                  className="rounded border border-[var(--border)] px-2 py-1 text-[11px] hover:border-[var(--accent)]"
                >
                  Retry
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function AuditLogPanel() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const auditQuery = useQuery({
    queryKey: ['admin', 'audit-log', { action, from, to }],
    queryFn: () =>
      fetchAuditLog({
        action: action.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: 50,
      }),
    retry: false,
  });

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Filter action (e.g. member.invite)..."
          aria-label="Filter audit action"
          className="min-h-[36px] min-w-[200px] flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px]"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="Audit log from date"
          className="min-h-[36px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-2.5 text-[12px]"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="Audit log to date"
          className="min-h-[36px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-2.5 text-[12px]"
        />
      </div>

      {auditQuery.isLoading ? (
        <p className="text-[12px] text-[var(--text-secondary)]">Loading audit log...</p>
      ) : auditQuery.isError ? (
        <p className="text-[12px] text-[var(--danger)]">
          {auditQuery.error instanceof Error ? auditQuery.error.message : 'Requires Admin role.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="border-b border-[var(--divider)] text-[11px] text-[var(--text-muted)]">
              <tr>
                <th className="py-2">Time</th>
                <th className="py-2">Actor</th>
                <th className="py-2">Action</th>
                <th className="py-2">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--divider)]">
              {(auditQuery.data?.entries ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="py-2 font-mono text-[11px] text-[var(--text-muted)]">{e.createdAt}</td>
                  <td className="py-2">{e.actorEmail ?? e.actorUserId}</td>
                  <td className="py-2 font-mono text-[var(--accent)]">{e.action}</td>
                  <td className="py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                    {e.targetType}:{e.targetId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function DataQualityPanel() {
  const dqQuery = useQuery({ queryKey: ['admin', 'data-quality'], queryFn: fetchDataQuality, retry: false });

  if (dqQuery.isLoading) return <Card className="p-6 text-[12px]">Checking data quality...</Card>;
  if (dqQuery.isError || !dqQuery.data) {
    return (
      <Card className="p-5 text-[12px] text-[var(--danger)]">
        {dqQuery.error instanceof Error ? dqQuery.error.message : 'Requires Admin role.'}
      </Card>
    );
  }

  const d = dqQuery.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Missing Duration', d.counts.missingDuration],
          ['Unclassified Shorts', d.counts.unclassifiedShorts],
          ['Stale Sources', d.counts.staleSources],
          ['Orphan Claims', d.counts.orphanClaims],
        ].map(([label, val]) => (
          <Card key={String(label)} className="p-3.5">
            <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
            <div className="mt-1 text-[20px] font-bold text-[var(--text-strong)]">{val}</div>
          </Card>
        ))}
      </div>

      <Card className="p-4 text-[12px]">
        <h3 className="text-[13px] font-semibold text-[var(--text-strong)]">
          Items &amp; Sources Requiring Attention
        </h3>
        <div className="mt-2 space-y-1.5 text-[var(--text-secondary)]">
          {d.staleSources.map((s) => (
            <div key={s.followId}>
              Stale source: <span className="text-[var(--text-primary)]">{s.displayName}</span> (
              {s.lastSyncedAt ?? 'never synced'})
            </div>
          ))}
          {d.unclassifiedShorts.slice(0, 8).map((u) => (
            <div key={u.itemId}>
              Unclassified short/video: <span className="text-[var(--text-primary)]">{u.title}</span>
            </div>
          ))}
          {d.missingDuration.slice(0, 8).map((m) => (
            <div key={m.itemId}>
              Missing duration: <span className="text-[var(--text-primary)]">{m.title}</span>
            </div>
          ))}
          {d.orphanClaims.map((o) => (
            <div key={o.claimId}>
              Orphan claim: <span className="text-[var(--text-primary)]">{o.title}</span> ({o.status})
            </div>
          ))}
          {d.counts.missingDuration +
            d.counts.unclassifiedShorts +
            d.counts.staleSources +
            d.counts.orphanClaims ===
            0 && <p>All items, sources, and claims are clean.</p>}
        </div>
      </Card>
    </div>
  );
}
