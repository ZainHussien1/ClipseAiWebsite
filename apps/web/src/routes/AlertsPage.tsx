import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { BellRing, CheckCircle2, ExternalLink, KanbanSquare } from 'lucide-react';
import { useState } from 'react';
import { AlertVoteButtons } from '../components/ui/AlertVoteButtons';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ApiError,
  acknowledgeAlert,
  claimFromAlert,
  listAlerts,
} from '../lib/api-v1';
import type { AlertConfidence, AlertDeliveryStatus } from '../lib/contracts';
import { formatAgeSeconds, formatProvenance, normalizeHandle, safeExternalUrl } from '../lib/url';

const CONFIDENCE_STYLE: Record<AlertConfidence, { bg: string; color: string }> = {
  high: { bg: 'var(--success-bg)', color: 'var(--success)' },
  medium: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  low: { bg: 'var(--surface-2)', color: 'var(--text-secondary)' },
};

const DELIVERY_STYLE: Record<AlertDeliveryStatus, { bg: string; color: string }> = {
  detected: { bg: 'var(--surface-2)', color: 'var(--text-secondary)' },
  queued: { bg: 'var(--accent-tint)', color: 'var(--accent)' },
  delivered: { bg: 'var(--success-bg)', color: 'var(--success)' },
  suppressed: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  failed: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
};

export function AlertsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const alertsQuery = useQuery({
    queryKey: ['alerts'],
    queryFn: listAlerts,
  });

  const ackMutation = useMutation({
    mutationFn: (alertId: string) => acknowledgeAlert(alertId),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Acknowledge failed'),
  });

  const createTaskMutation = useMutation({
    mutationFn: (alertId: string) => claimFromAlert(alertId),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['work-board'] });
      void navigate({ to: '/work' });
    },
    onError: (err) =>
      setActionError(err instanceof ApiError ? err.message : 'Failed to create task from alert'),
  });

  const alerts = alertsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Alerts</h1>
        <p className="text-[12px] text-[var(--text-secondary)]">
          Observable alert lifecycle (detected &rarr; queued &rarr; delivered/suppressed &rarr;
          acknowledged &rarr; claimed).
        </p>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-[12px]"
          style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
        >
          {actionError}
        </div>
      )}

      {alertsQuery.isLoading ? (
        <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading alerts...</Card>
      ) : alertsQuery.isError ? (
        <Card className="p-5 text-[12px] text-[var(--danger)]">
          {alertsQuery.error instanceof Error ? alertsQuery.error.message : 'Failed to load alerts'}
        </Card>
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title="No alerts recorded yet"
          description="Live Moment viewer spikes, Twitch clip velocity, and Rising breakouts will appear here with evidence."
        />
      ) : (
        <div className="space-y-2.5">
          {alerts.map((alert) => {
            const confStyle = CONFIDENCE_STYLE[alert.confidence];
            const externalUrl = safeExternalUrl(alert.url);
            const deliveries = alert.deliveries ?? [];
            return (
              <Card key={alert.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                        style={{ backgroundColor: confStyle.bg, color: confStyle.color }}
                      >
                        {alert.confidence} confidence
                      </span>
                      <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 uppercase text-[var(--text-secondary)]">
                        {alert.type.replace('_', ' ')}
                      </span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {alert.accountDisplayName || normalizeHandle(alert.accountHandle)}
                      </span>
                      {alert.remindedAt && (
                        <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[10px] text-[var(--accent)]">
                          Escalated 1x
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1.5 text-[14px] font-semibold text-[var(--text-strong)]">
                      {alert.title}
                    </h2>
                    <p className="mt-1 text-[12px] text-[var(--text-primary)]">{alert.reason}</p>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-secondary)]">
                        detected
                      </span>
                      {deliveries.map((d) => {
                        const st = DELIVERY_STYLE[d.status];
                        return (
                          <span
                            key={d.id}
                            className="rounded-full px-2 py-0.5 font-medium"
                            style={{ backgroundColor: st.bg, color: st.color }}
                          >
                            {d.channel}: {d.status}
                            {d.reason ? ` (${d.reason})` : ''}
                          </span>
                        );
                      })}
                      {alert.acknowledgedAt && (
                        <span
                          className="rounded-full px-2 py-0.5 font-medium"
                          style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)' }}
                        >
                          acknowledged
                        </span>
                      )}
                      {alert.claimedBy && (
                        <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 font-medium text-[var(--accent)]">
                          claimed by {alert.claimedBy}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                      {formatProvenance(alert.source, alert.platform)} ·{' '}
                      {formatAgeSeconds(alert.ageSeconds)}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!alert.acknowledgedAt && (
                      <button
                        type="button"
                        disabled={ackMutation.isPending}
                        onClick={() => ackMutation.mutate(alert.id)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--accent)]"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Acknowledge
                      </button>
                    )}
                    {!alert.claimedBy && (
                      <button
                        type="button"
                        disabled={createTaskMutation.isPending}
                        onClick={() => createTaskMutation.mutate(alert.id)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-[11px] font-semibold text-[#0c1519]"
                      >
                        <KanbanSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
                        Create task from alert
                      </button>
                    )}
                    <AlertVoteButtons alertId={alert.id} userVote={alert.userVote} />
                    {externalUrl && (
                      <a
                        href={externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open alert source"
                        className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
