import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ExternalLink, Radio, Scissors } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { ClaimModal } from '../components/ui/ClaimModal';
import { EmptyState } from '../components/ui/EmptyState';
import { ProviderStatusBar } from '../components/ui/ProviderStatusBar';
import { fetchLive, fetchProviderStatus } from '../lib/api-v1';
import {
  formatAgeSeconds,
  formatCount,
  formatDurationSince,
  formatProvenance,
  normalizeHandle,
  safeExternalUrl,
} from '../lib/url';

export function LivePage() {
  const queryClient = useQueryClient();
  const [wsConnected, setWsConnected] = useState(false);
  const [claimTarget, setClaimTarget] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      try {
        socket = new WebSocket(`${proto}//${window.location.host}/api/v1/ws`);
      } catch {
        setWsConnected(false);
        return;
      }

      socket.onopen = () => {
        attempt = 0;
        setWsConnected(true);
      };

      socket.onmessage = () => {
        void queryClient.invalidateQueries({ queryKey: ['live'] });
      };

      socket.onclose = () => {
        setWsConnected(false);
        if (closed) return;
        const backoff = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, backoff);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [queryClient]);

  const liveQuery = useQuery({
    queryKey: ['live'],
    queryFn: fetchLive,
    refetchInterval: wsConnected ? false : 15_000,
  });

  const providerQuery = useQuery({
    queryKey: ['providers', 'status'],
    queryFn: fetchProviderStatus,
    staleTime: 60_000,
  });

  const streams = liveQuery.data?.streams ?? [];
  const needsLiveCredentials =
    providerQuery.data?.twitch.status === 'credentials_missing' ||
    providerQuery.data?.kick.status === 'credentials_missing';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Live Now</h1>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Active streams with viewer counts, source age, and duration.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-medium"
          style={{
            backgroundColor: wsConnected ? 'var(--success-bg)' : 'var(--surface)',
            color: wsConnected ? 'var(--success)' : 'var(--text-secondary)',
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: wsConnected ? 'var(--success)' : 'var(--warning)' }}
          />
          {wsConnected ? 'Realtime WS' : 'Polling fallback (15s)'}
        </span>
      </div>

      <ProviderStatusBar />

      {needsLiveCredentials && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="text-[13px] font-semibold text-[var(--text-strong)]">
              Connect Twitch / Kick for live stream webhooks &amp; polling
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              Twitch or Kick credentials are not configured yet. Add Worker secrets and verify in
              Settings &rarr; Integrations.
            </p>
          </div>
          <Link
            to="/settings"
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-tint)] px-3 text-[12px] font-medium text-[var(--text-strong)]"
          >
            Open Integrations
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Link>
        </Card>
      )}

      {liveQuery.isLoading ? (
        <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Checking live streams...</Card>
      ) : liveQuery.isError ? (
        <Card className="p-5 text-[12px] text-[var(--danger)]">
          {liveQuery.error instanceof Error ? liveQuery.error.message : 'Failed to load live streams'}
        </Card>
      ) : streams.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No tracked creators are live right now"
          description="When a tracked creator goes live on YouTube, Twitch, or Kick, their stream appears here in real time."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {streams.map((stream) => {
            const externalUrl = safeExternalUrl(stream.url);
            return (
              <Card key={stream.itemId} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                        style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
                      >
                        LIVE
                      </span>
                      <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 uppercase text-[var(--text-secondary)]">
                        {stream.platform}
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {stream.accountDisplayName || normalizeHandle(stream.accountHandle)}
                      </span>
                    </div>
                    <h2 className="mt-1.5 line-clamp-2 text-[14px] font-semibold text-[var(--text-strong)]">
                      {stream.title}
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                      <span>Viewers: {formatCount(stream.viewers)}</span>
                      <span>Duration: {formatDurationSince(stream.startedAt)}</span>
                      <span>
                        {formatProvenance(stream.source, stream.platform)} ·{' '}
                        {formatAgeSeconds(stream.ageSeconds)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {externalUrl && (
                      <a
                        href={externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open live stream"
                        className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      >
                        <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setClaimTarget({ id: stream.itemId, title: stream.title })}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-[#0c1519]"
                    >
                      <Scissors className="h-3.5 w-3.5" strokeWidth={1.8} />
                      Claim
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {claimTarget && (
        <ClaimModal
          itemId={claimTarget.id}
          itemTitle={claimTarget.title}
          onClose={() => setClaimTarget(null)}
        />
      )}
    </div>
  );
}
