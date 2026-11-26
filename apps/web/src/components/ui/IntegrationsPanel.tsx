import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, ChevronDown, CircleDashed, Copy, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import {
  ApiError,
  fetchAdminIntegrations,
  verifyAdminIntegration,
} from '../../lib/api-v1';
import type {
  IntegrationDetail,
  IntegrationStatus,
  IntegrationVerifyResponse,
  Platform,
} from '../../lib/contracts';
import { Card } from './Card';

const STATUS_STYLE: Record<IntegrationStatus, { label: string; bg: string; color: string }> = {
  not_configured: { label: 'Not configured', bg: 'var(--surface-2)', color: 'var(--text-secondary)' },
  verifying: { label: 'Verifying', bg: 'var(--accent-tint)', color: 'var(--accent)' },
  healthy: { label: 'Healthy', bg: 'var(--success-bg)', color: 'var(--success)' },
  degraded: { label: 'Degraded', bg: 'var(--warning-bg)', color: 'var(--warning)' },
  failing: { label: 'Failing', bg: 'var(--danger-bg)', color: 'var(--danger)' },
};

function IntegrationCard({
  item,
  verifying,
  verifyResult,
  onVerify,
}: {
  item: IntegrationDetail;
  verifying: boolean;
  verifyResult: IntegrationVerifyResponse | undefined;
  onVerify: (p: Platform) => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const badge = STATUS_STYLE[item.status];
  const quotaPct = Math.min(100, Math.round((item.quotaUsedToday / item.quotaLimitDaily) * 100));

  const copyValue = (key: string, val: string) => {
    void navigator.clipboard.writeText(val).then(() => {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1500);
    });
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--divider)] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold capitalize text-[var(--text-strong)]">
              {item.platform}
            </h3>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: badge.bg, color: badge.color }}
            >
              {badge.label}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">Mode: {item.mode}</p>
        </div>

        <button
          type="button"
          disabled={verifying}
          onClick={() => onVerify(item.platform)}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-tint)] px-3 text-[12px] font-medium text-[var(--text-strong)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          {verifying ? 'Verifying...' : 'Verify Connection'}
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3 text-[12px]">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
          <div className="text-[11px] text-[var(--text-muted)]">Quota Today</div>
          <div className="mt-1 font-mono text-[var(--text-primary)]">
            {item.quotaUsedToday.toLocaleString()} / {item.quotaLimitDaily.toLocaleString()} ({quotaPct}%)
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
          <div className="text-[11px] text-[var(--text-muted)]">Webhook Subscriptions</div>
          <div className="mt-1 font-mono text-[var(--text-primary)]">{item.subscriptionCount}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
          <div className="text-[11px] text-[var(--text-muted)]">Next Lease Renewal</div>
          <div className="mt-1 font-mono text-[var(--text-primary)]">
            {item.nextLeaseRenewalAt ?? 'n/a'}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Secrets Configured
        </div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {Object.entries(item.secretPresence).map(([secretName, present]) => (
            <span
              key={secretName}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[11px]"
              style={{ color: present ? 'var(--success)' : 'var(--text-muted)' }}
            >
              {present ? (
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              ) : (
                <CircleDashed className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              {secretName}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-1.5 text-[12px]">
        {(
          [
            ['Webhook URL', 'webhook', item.callbackUrls.webhookUrl],
            ...(item.callbackUrls.oauthCallbackUrl
              ? [['OAuth Callback URL', 'oauth', item.callbackUrls.oauthCallbackUrl] as const]
              : []),
          ] as const
        ).map(([label, key, url]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <span className="mr-2 text-[11px] text-[var(--text-muted)]">{label}:</span>
              <span className="truncate font-mono text-[11px] text-[var(--text-primary)]">{url}</span>
            </div>
            <button
              type="button"
              onClick={() => copyValue(key, url)}
              aria-label={`Copy ${label}`}
              className="inline-flex min-h-[32px] items-center gap-1 rounded px-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {copiedKey === key ? (
                <Check className="h-3.5 w-3.5 text-[var(--success)]" strokeWidth={1.5} />
              ) : (
                <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              {copiedKey === key ? 'Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </div>

      {verifyResult && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-[var(--border)] px-3 py-2 text-[12px]"
          style={{
            backgroundColor: verifyResult.ok ? 'var(--success-bg)' : 'var(--warning-bg)',
            color: verifyResult.ok ? 'var(--success)' : 'var(--warning)',
          }}
        >
          {verifyResult.message} (checked {verifyResult.checkedAt})
        </div>
      )}

      <div className="mt-3 border-t border-[var(--divider)] pt-2.5">
        <button
          type="button"
          onClick={() => setStepsOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)]"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${stepsOpen ? 'rotate-180' : ''}`}
            strokeWidth={1.5}
          />
          {stepsOpen ? 'Hide setup instructions' : 'Show setup instructions'}
        </button>
        {stepsOpen && (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] text-[var(--text-secondary)]">
            {item.setupSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

export function IntegrationsPanel() {
  const queryClient = useQueryClient();
  const [verifyResults, setVerifyResults] = useState<Partial<Record<Platform, IntegrationVerifyResponse>>>({});
  const [verifyingPlatform, setVerifyingPlatform] = useState<Platform | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const integrationsQuery = useQuery({
    queryKey: ['admin', 'integrations'],
    queryFn: fetchAdminIntegrations,
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: verifyAdminIntegration,
    onMutate: (platform) => {
      setVerifyingPlatform(platform);
      setVerifyError(null);
    },
    onSuccess: (res) => {
      setVerifyResults((prev) => ({ ...prev, [res.platform]: res }));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'integrations'] });
      void queryClient.invalidateQueries({ queryKey: ['providers', 'status'] });
    },
    onError: (err) => {
      setVerifyError(err instanceof ApiError ? err.message : 'Verification failed');
    },
    onSettled: () => setVerifyingPlatform(null),
  });

  if (integrationsQuery.isLoading) {
    return <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading integrations...</Card>;
  }

  if (integrationsQuery.isError) {
    return (
      <Card className="p-5 text-[12px] text-[var(--danger)]">
        {integrationsQuery.error instanceof Error
          ? integrationsQuery.error.message
          : 'Integrations require Admin or Owner role.'}
      </Card>
    );
  }

  const data = integrationsQuery.data;
  if (!data) return null;

  return (
    <div className="space-y-4">
      {verifyError && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-[12px]"
          style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
        >
          {verifyError}
        </div>
      )}

      {data.integrations.map((item) => (
        <IntegrationCard
          key={item.platform}
          item={item}
          verifying={verifyingPlatform === item.platform}
          verifyResult={verifyResults[item.platform]}
          onVerify={(p) => verifyMutation.mutate(p)}
        />
      ))}

      <Card className="p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Shared Platform Secrets
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(data.extraSecrets).map(([name, present]) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[11px]"
              style={{ color: present ? 'var(--success)' : 'var(--text-muted)' }}
            >
              {present ? (
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              ) : (
                <CircleDashed className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              {name}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
