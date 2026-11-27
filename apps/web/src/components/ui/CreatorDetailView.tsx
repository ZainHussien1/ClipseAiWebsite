import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchCreatorDetail, updateCreatorNotes, updateSource } from '../../lib/api-v1';
import type { ActiveRisingTier } from '../../lib/contracts';
import {
  formatAgeSeconds,
  formatCount,
  formatLatencyMs,
  formatProvenance,
  normalizeHandle,
  safeExternalUrl,
} from '../../lib/url';
import { Card } from './Card';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CreatorDetailView({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ['creators', accountId],
    queryFn: () => fetchCreatorDetail(accountId),
  });

  const [notesBody, setNotesBody] = useState('');
  const [notesSaved, setNotesSaved] = useState<string | null>(null);
  const [laneTab, setLaneTab] = useState<'videos' | 'shorts' | 'live' | 'unclassified'>('videos');

  useEffect(() => {
    if (detailQuery.data?.notes) {
      setNotesBody(detailQuery.data.notes.body);
    }
  }, [detailQuery.data?.notes]);

  const notesMutation = useMutation({
    mutationFn: () => updateCreatorNotes(accountId, notesBody),
    onSuccess: () => {
      setNotesSaved('Notes saved.');
      void queryClient.invalidateQueries({ queryKey: ['creators', accountId] });
    },
  });

  const ruleMutation = useMutation({
    mutationFn: ({
      followId,
      rules,
    }: {
      followId: string;
      rules: {
        minRisingLevel?: ActiveRisingTier;
        notifyLive?: boolean;
        notifyUploads?: boolean;
        muted?: boolean;
      };
    }) => updateSource(followId, { rules }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['creators', accountId] }),
  });

  if (detailQuery.isLoading) {
    return <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading creator...</Card>;
  }
  if (detailQuery.isError || !detailQuery.data) {
    return <Card className="p-5 text-[12px] text-[var(--danger)]">Failed to load creator.</Card>;
  }

  const { creator, itemsByLane, cadence, notes } = detailQuery.data;
  const laneItems = itemsByLane[laneTab];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-secondary)]">
              {creator.platform}
            </span>
            <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">
              {creator.displayName || normalizeHandle(creator.handle)}
            </h1>
            <span className="font-mono text-[12px] text-[var(--text-muted)]">
              {normalizeHandle(creator.handle)}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
            Subscription: {creator.subscriptionHealth.status} · {creator.cadenceSummary}
          </p>
        </div>
        <Link
          to="/creators"
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          All Creators
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Team Claims / Clips</div>
          <div className="mt-1 text-[18px] font-bold text-[var(--text-strong)]">
            {creator.teamRoi.claimsCount} / {creator.teamRoi.clipsCount}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            Hit rate:{' '}
            {creator.teamRoi.hitRate !== null
              ? `${(creator.teamRoi.hitRate * 100).toFixed(0)}%`
              : 'n/a'}
          </div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Median Clip Views</div>
          <div className="mt-1 text-[18px] font-bold text-[var(--text-strong)]">
            {formatCount(creator.teamRoi.medianClipViews)}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            Time to clip: {formatLatencyMs(creator.teamRoi.medianTimeToClipMs)}
          </div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Baselines (&gt;7d)</div>
          <div className="mt-1 space-y-0.5 text-[12px]">
            {creator.baselines.length === 0 ? (
              <span className="text-[var(--text-secondary)]">Collecting</span>
            ) : (
              creator.baselines.map((b) => (
                <div key={b.kind} className="flex justify-between">
                  <span className="uppercase text-[var(--text-secondary)]">{b.kind}</span>
                  <span className="font-mono text-[var(--text-strong)]">
                    {formatCount(b.medianViews)} (n={b.sampleSize})
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
        <Card className="p-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">Per-Creator Rules</div>
          <div className="mt-1.5 space-y-1 text-[12px]">
            <label className="flex items-center justify-between">
              <span>Min Rising</span>
              <select
                value={creator.rules.minRisingLevel}
                onChange={(e) =>
                  ruleMutation.mutate({
                    followId: creator.followId,
                    rules: { minRisingLevel: e.target.value as ActiveRisingTier },
                  })
                }
                className="rounded border border-[var(--input-border)] bg-[var(--input)] px-1.5 py-0.5 text-[11px]"
              >
                <option value="rising">Rising</option>
                <option value="breakout">Breakout</option>
                <option value="viral">Viral</option>
              </select>
            </label>
            <label className="flex items-center justify-between">
              <span>Muted</span>
              <input
                type="checkbox"
                checked={creator.rules.muted}
                onChange={(e) =>
                  ruleMutation.mutate({
                    followId: creator.followId,
                    rules: { muted: e.target.checked },
                  })
                }
                className="accent-[var(--accent)]"
              />
            </label>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
              Observed Activity Cadence
            </h2>
            <span className="text-[11px] text-[var(--text-muted)]">
              Based on {cadence.observedEvents} observed events
            </span>
          </div>
          {!cadence.ready ? (
            <p className="mt-3 text-[12px] text-[var(--text-secondary)]">
              Heatmap hidden until at least {cadence.sampleFloor} observed events are collected (
              {cadence.observedEvents}/{cadence.sampleFloor}).
            </p>
          ) : (
            <div className="mt-3 space-y-1.5">
              <div className="text-[12px] text-[var(--text-secondary)]">
                Avg/week: {cadence.avgPerWeek?.toFixed(1) ?? 'n/a'}
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
                {DAYS.map((d, dow) => {
                  const total = cadence.heatmap
                    .filter((b) => b.dayOfWeek === dow)
                    .reduce((acc, b) => acc + b.count, 0);
                  return (
                    <div
                      key={d}
                      className="rounded border border-[var(--border)] bg-[var(--surface-2)] py-2"
                    >
                      <div className="text-[var(--text-muted)]">{d}</div>
                      <div className="mt-0.5 font-mono text-[var(--accent)]">{total}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">Team Notes</h2>
            {notes.updatedByEmail && (
              <span className="text-[11px] text-[var(--text-muted)]">
                Updated by {notes.updatedByEmail}
              </span>
            )}
          </div>
          <textarea
            rows={3}
            value={notesBody}
            onChange={(e) => setNotesBody(e.target.value)}
            placeholder="Editing notes, best clip angles, or tone..."
            aria-label="Creator team notes"
            className="mt-2 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] p-2.5 text-[12px]"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={notesMutation.isPending}
              onClick={() => notesMutation.mutate()}
              className="min-h-[36px] rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-[#0c1519]"
            >
              Save Notes
            </button>
            {notesSaved && <span className="text-[12px] text-[var(--success)]">{notesSaved}</span>}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--divider)] pb-3">
          {(
            [
              ['videos', `Videos (${itemsByLane.videos.length})`],
              ['shorts', `Shorts (${itemsByLane.shorts.length})`],
              ['live', `Live (${itemsByLane.live.length})`],
              ...(itemsByLane.unclassified.length > 0
                ? [['unclassified', `Unclassified (${itemsByLane.unclassified.length})`] as const]
                : []),
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setLaneTab(k)}
              className={`min-h-[34px] rounded-full border px-3 text-[11px] font-medium ${
                laneTab === k
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                  : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          {laneItems.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-[var(--text-secondary)]">
              No items in this lane yet.
            </p>
          ) : (
            laneItems.map((it) => {
              const ext = safeExternalUrl(it.url);
              return (
                <div
                  key={it.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[12px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-[var(--text-strong)]">{it.title}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      Views: {formatCount(it.latestViews)} ·{' '}
                      {formatProvenance(it.source, it.platform)} ·{' '}
                      {formatAgeSeconds(it.ageSeconds)}
                    </div>
                  </div>
                  {ext && (
                    <a
                      href={ext}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open creator item"
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
                    </a>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
