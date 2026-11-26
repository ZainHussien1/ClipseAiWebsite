import { useQuery } from '@tanstack/react-query';
import { BellRing, ExternalLink } from 'lucide-react';
import { AlertVoteButtons } from '../components/ui/AlertVoteButtons';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { listAlerts } from '../lib/api-v1';
import type { AlertConfidence } from '../lib/contracts';
import { formatAgeSeconds, safeExternalUrl } from '../lib/url';

const CONFIDENCE_STYLE: Record<AlertConfidence, { bg: string; color: string }> = {
  high: { bg: 'var(--success-bg)', color: 'var(--success)' },
  medium: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  low: { bg: 'var(--surface-2)', color: 'var(--text-secondary)' },
};

export function AlertsPage() {
  const alertsQuery = useQuery({
    queryKey: ['alerts'],
    queryFn: listAlerts,
  });

  const alerts = alertsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Alerts</h1>
        <p className="text-[12px] text-[var(--text-secondary)]">
          Evidence-backed Rising, Live Moment, and VOD-ready alerts. Vote to calibrate the
          scorecard.
        </p>
      </div>

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
                        {alert.accountDisplayName || alert.accountHandle}
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
                    <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                      {alert.source} · {formatAgeSeconds(alert.ageSeconds)}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
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
