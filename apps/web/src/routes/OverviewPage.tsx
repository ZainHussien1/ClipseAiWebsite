import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Activity, ArrowRight, Radio, Rss, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import { NAV_ITEMS } from '../components/shell/nav';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusPill } from '../components/ui/StatusPill';
import { fetchHealth, fetchMe, type HealthSnapshot, type PrincipalSnapshot } from '../lib/api';
import { useRelativeAge } from '../lib/useRelativeAge';

const QUICK_ROUTES = new Set(['/feed', '/live', '/rising', '/sources']);

function HealthAuthCard({
  health,
  me,
  healthLoading,
  meLoading,
}: {
  health: HealthSnapshot | undefined;
  me: PrincipalSnapshot | undefined;
  healthLoading: boolean;
  meLoading: boolean;
}) {
  const healthAge = useRelativeAge(health?.fetchedAtMs);
  const meAge = useRelativeAge(me?.fetchedAtMs);

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--divider)] pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
            System Health &amp; Access Identity
          </h2>
        </div>
        <StatusPill
          status={health?.status ?? (healthLoading ? 'degraded' : 'offline')}
          fetchedAtMs={health?.fetchedAtMs}
          source={health?.source ?? '/api/v1/health'}
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            <span>Edge API Health</span>
            <span>{health?.source ?? '/api/v1/health'}</span>
          </div>
          <dl className="mt-2.5 space-y-1.5 text-[12px]">
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-secondary)]">Status</dt>
              <dd className="font-mono text-[var(--text-primary)]">
                {healthLoading ? 'checking...' : (health?.rawStatus ?? 'unknown')}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-secondary)]">Latency</dt>
              <dd className="font-mono text-[var(--text-primary)]">
                {health ? `${health.latencyMs} ms` : 'unknown'}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-secondary)]">Checked</dt>
              <dd className="font-mono text-[var(--text-primary)]">{healthAge}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent)]" strokeWidth={1.5} />
              Cloudflare Access
            </span>
            <span>{me?.source ?? '/api/v1/me'}</span>
          </div>
          <dl className="mt-2.5 space-y-1.5 text-[12px]">
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-secondary)]">Principal</dt>
              <dd className="font-mono text-[var(--text-primary)]">
                {meLoading
                  ? 'verifying...'
                  : me?.authenticated
                    ? (me.email ?? 'verified')
                    : (me?.detail ?? 'unauthenticated')}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-secondary)]">Workspace Role</dt>
              <dd className="font-mono text-[var(--text-primary)]">
                {me?.authenticated ? (me.role ?? 'Member') : 'none'}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[var(--text-secondary)]">Checked</dt>
              <dd className="font-mono text-[var(--text-primary)]">{meAge}</dd>
            </div>
          </dl>
        </div>
      </div>
    </Card>
  );
}

export function OverviewPage() {
  const healthQuery = useQuery({
    queryKey: ['system', 'health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    retry: 1,
  });

  const meQuery = useQuery({
    queryKey: ['system', 'me'],
    queryFn: fetchMe,
    retry: false,
  });

  const quickNavItems = NAV_ITEMS.filter((item) => QUICK_ROUTES.has(item.to));

  return (
    <div className="space-y-5">
      <div className="hero-surface flex flex-col justify-between gap-4 rounded-xl border border-[var(--border)] p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="max-w-xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#0c1519]/80">
            CLIPSE RADAR · PHASE 1 FOUNDATION
          </div>
          <h1 className="mt-1 text-[22px] font-bold leading-tight tracking-tight text-[#0c1519] sm:text-[24px]">
            Creator monitoring &amp; live signal workspace
          </h1>
          <p className="mt-1.5 text-[12.5px] font-medium text-[#0c1519]/85">
            Track YouTube, Twitch, and Kick uploads, detect live moments, and coordinate team
            claims without fabricated metrics.
          </p>
        </div>
        <Link
          to="/sources"
          className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold text-[var(--text-strong)]"
          style={{ backgroundColor: 'var(--hero-btn)' }}
        >
          <span>View Sources</span>
          <ArrowRight className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </div>

      <HealthAuthCard
        health={healthQuery.data}
        me={meQuery.data}
        healthLoading={healthQuery.isLoading}
        meLoading={meQuery.isLoading}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {quickNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className="group flex min-h-[96px] flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--input-border)] hover:bg-[var(--surface-2)]"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] group-hover:text-[var(--accent)]">
                  <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <span className="text-[11px] font-medium text-[var(--text-muted)]">
                  {item.phaseLabel}
                </span>
              </div>
              <div className="mt-3">
                <div className="text-[13px] font-semibold text-[var(--text-strong)]">
                  {item.label}
                </div>
                <div className="mt-0.5 line-clamp-1 text-[12px] text-[var(--text-secondary)]">
                  {item.description}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <EmptyState
        icon={Rss}
        badge="Phase 1 Empty State"
        title="No tracked sources or live signals yet"
        description="Channel ingestion, webhook processing, and live stream tracking are scheduled for Phases 2 and 3. Connect your workspace sources once ingestion lands."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1">
              <Users className="h-3.5 w-3.5 text-[var(--accent)]" strokeWidth={1.5} />
              Sources: Phase 3
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1">
              <Radio className="h-3.5 w-3.5 text-[var(--danger)]" strokeWidth={1.5} />
              Live Now: Phase 3–4
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1">
              <TrendingUp className="h-3.5 w-3.5 text-[var(--success)]" strokeWidth={1.5} />
              Rising: Phase 3
            </span>
          </div>
        }
      />
    </div>
  );
}
