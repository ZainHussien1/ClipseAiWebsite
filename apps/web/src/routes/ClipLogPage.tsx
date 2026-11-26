import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2, Scissors } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ApiError, confirmClipLink, createClip, listClips, listSources } from '../lib/api-v1';
import type { ClipPlatform } from '../lib/contracts';
import { formatCount, safeExternalUrl } from '../lib/url';

export function ClipLogPage() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState<ClipPlatform>('youtube');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [manualViews, setManualViews] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmLinks, setConfirmLinks] = useState<Record<string, string>>({});

  const clipsQuery = useQuery({ queryKey: ['clips'], queryFn: listClips });
  const sourcesQuery = useQuery({ queryKey: ['sources'], queryFn: listSources });

  const createMutation = useMutation({
    mutationFn: createClip,
    onSuccess: () => {
      setUrl('');
      setTitle('');
      setDescription('');
      setManualViews('');
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['clips'] });
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : 'Failed to log clip');
    },
  });

  const confirmMutation = useMutation({
    mutationFn: ({ clipId, sourceItemId }: { clipId: string; sourceItemId: string }) =>
      confirmClipLink(clipId, sourceItemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clips'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!url.trim().startsWith('https://')) {
      setFormError('Clip URL must start with https://');
      return;
    }
    const viewsNum = manualViews.trim() !== '' ? Number(manualViews) : null;
    if (viewsNum !== null && (!Number.isInteger(viewsNum) || viewsNum < 0)) {
      setFormError('Manual views must be a non-negative integer.');
      return;
    }
    createMutation.mutate({
      url: url.trim(),
      platform,
      title: title.trim() || undefined,
      description: description.trim() || undefined,
      manualStats: viewsNum !== null ? { views: viewsNum } : undefined,
    });
  };

  const ownChannels = (sourcesQuery.data ?? []).filter((s) => s.isOwn);
  const clips = clipsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Clip Log</h1>
        <p className="text-[12px] text-[var(--text-secondary)]">
          Published clips, Our Channels prefill, source link confirmation, and manual vs API stats.
        </p>
      </div>

      {ownChannels.length > 0 && (
        <Card className="p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Our Channels (is_own)
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {ownChannels.map((ch) => (
              <span
                key={ch.followId}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-primary)]"
              >
                {ch.platform}: {ch.displayName || ch.handle}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <form onSubmit={handleSubmit} className="grid gap-2.5 sm:grid-cols-12">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/shorts/... or TikTok/IG/X clip URL"
            aria-label="Clip URL"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)] sm:col-span-5"
          />
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ClipPlatform)}
            aria-label="Clip platform"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px] text-[var(--text-primary)] sm:col-span-2"
          >
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="x">X</option>
            <option value="twitch">Twitch</option>
            <option value="kick">Kick</option>
          </select>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            aria-label="Clip title"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)] sm:col-span-3"
          />
          <input
            type="number"
            min={0}
            value={manualViews}
            onChange={(e) => setManualViews(e.target.value)}
            placeholder="Manual views"
            aria-label="Manual views"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)] sm:col-span-2"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (paste source URL for auto-link match)"
            aria-label="Clip description"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)] sm:col-span-10"
          />
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="min-h-[40px] rounded-lg bg-[var(--accent)] px-4 text-[12px] font-semibold text-[#0c1519] disabled:opacity-50 sm:col-span-2"
          >
            {createMutation.isPending ? 'Logging...' : 'Log Clip'}
          </button>
        </form>
        {formError && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-[var(--border)] px-3 py-2 text-[12px]"
            style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
          >
            {formError}
          </div>
        )}
      </Card>

      {clipsQuery.isLoading ? (
        <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading clip log...</Card>
      ) : clips.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title="No clips logged yet"
          description="Log published clips above or connect Our Channels to prefill uploads automatically."
        />
      ) : (
        <div className="space-y-2.5">
          {clips.map((clip) => {
            const safeUrl = safeExternalUrl(clip.url);
            return (
              <Card key={clip.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-semibold uppercase text-[var(--text-secondary)]">
                        {clip.platform}
                      </span>
                      {clip.statsSource === 'manual' && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                          style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}
                        >
                          manual
                        </span>
                      )}
                      {clip.statsSource === 'api' && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                          style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)' }}
                        >
                          api
                        </span>
                      )}
                      {clip.needsConfirmation && (
                        <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[10px] text-[var(--accent)]">
                          Needs source confirmation
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1.5 text-[14px] font-semibold text-[var(--text-strong)]">
                      {clip.title ?? clip.url}
                    </h2>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                      <span>Views: {formatCount(clip.views)}</span>
                      <span>Stats source: {clip.statsSource ?? 'unknown'}</span>
                      {clip.statsCapturedAt && <span>Captured: {clip.statsCapturedAt}</span>}
                    </div>
                  </div>

                  {safeUrl && (
                    <a
                      href={safeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open clip"
                      className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
                    </a>
                  )}
                </div>

                {clip.needsConfirmation && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--divider)] pt-3">
                    <input
                      type="text"
                      value={confirmLinks[clip.id] ?? ''}
                      onChange={(e) =>
                        setConfirmLinks((prev) => ({ ...prev, [clip.id]: e.target.value }))
                      }
                      placeholder="Source item ID..."
                      aria-label="Source item ID to confirm"
                      className="min-h-[36px] flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px] text-[var(--text-primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const target = (confirmLinks[clip.id] ?? '').trim();
                        if (!target) return;
                        confirmMutation.mutate({ clipId: clip.id, sourceItemId: target });
                      }}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-tint)] px-3 text-[12px] font-medium text-[var(--text-strong)]"
                    >
                      <Link2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      Confirm Link
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
