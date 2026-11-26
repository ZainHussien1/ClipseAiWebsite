import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pause, Play, Plus, Star, Upload, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ApiError,
  bulkCreateSources,
  createSource,
  listSources,
  updateSource,
} from '../lib/api-v1';
import { formatAgeSeconds } from '../lib/url';

export function SourcesPage() {
  const queryClient = useQueryClient();
  const [singleInput, setSingleInput] = useState('');
  const [groupName, setGroupName] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLines, setBulkLines] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: listSources,
  });

  const addMutation = useMutation({
    mutationFn: createSource,
    onSuccess: () => {
      setSingleInput('');
      setTagsInput('');
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : 'Failed to add source');
    },
  });

  const bulkMutation = useMutation({
    mutationFn: bulkCreateSources,
    onSuccess: () => {
      setBulkLines('');
      setBulkOpen(false);
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : 'Bulk import failed');
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({
      followId,
      patch,
    }: {
      followId: string;
      patch: { starred?: boolean; paused?: boolean; archived?: boolean };
    }) => updateSource(followId, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  const visibleSources = useMemo(() => {
    const all = sourcesQuery.data ?? [];
    return all.filter((s) => (showArchived ? s.archived : !s.archived));
  }, [sourcesQuery.data, showArchived]);

  const handleSingleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = singleInput.trim();
    if (!trimmed) return;
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);
    addMutation.mutate({
      input: trimmed,
      groupName: groupName.trim() || undefined,
      tags,
    });
  };

  const handleBulkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!bulkLines.trim()) return;
    bulkMutation.mutate({
      rawLines: bulkLines,
      groupName: groupName.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Sources</h1>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Add YouTube, Twitch, or Kick channels by URL or handle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="min-h-[40px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {showArchived ? 'Show Active' : 'Show Archived'}
          </button>
          <button
            type="button"
            onClick={() => setBulkOpen((v) => !v)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--input-border)]"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
            Bulk Paste
          </button>
        </div>
      </div>

      <Card className="p-4">
        <form onSubmit={handleSingleSubmit} className="grid gap-2.5 sm:grid-cols-12">
          <input
            type="text"
            value={singleInput}
            onChange={(e) => setSingleInput(e.target.value)}
            placeholder="https://youtube.com/@handle, twitch.tv/channel, or kick.com/channel"
            aria-label="Channel URL or handle"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] sm:col-span-5"
          />
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group (optional)"
            aria-label="Group name"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] sm:col-span-3"
          />
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="Tags, comma-separated"
            aria-label="Tags"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] sm:col-span-2"
          />
          <button
            type="submit"
            disabled={addMutation.isPending}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-[#0c1519] disabled:opacity-50 sm:col-span-2"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {addMutation.isPending ? 'Adding...' : 'Add Source'}
          </button>
        </form>

        {bulkOpen && (
          <form onSubmit={handleBulkSubmit} className="mt-3 space-y-2 border-t border-[var(--divider)] pt-3">
            <textarea
              rows={4}
              value={bulkLines}
              onChange={(e) => setBulkLines(e.target.value)}
              placeholder="Paste one channel URL or CSV line per row..."
              aria-label="Bulk channel list"
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] p-3 font-mono text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={bulkMutation.isPending}
                className="min-h-[40px] rounded-lg bg-[var(--accent)] px-4 text-[12px] font-semibold text-[#0c1519] disabled:opacity-50"
              >
                {bulkMutation.isPending ? 'Importing...' : 'Import List'}
              </button>
            </div>
          </form>
        )}

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

      {sourcesQuery.isLoading ? (
        <Card className="p-6 text-[12px] text-[var(--text-secondary)]">Loading sources...</Card>
      ) : sourcesQuery.isError ? (
        <Card className="p-5 text-[12px] text-[var(--danger)]">
          {sourcesQuery.error instanceof Error ? sourcesQuery.error.message : 'Failed to load sources'}
        </Card>
      ) : visibleSources.length === 0 ? (
        <EmptyState
          icon={Users}
          title={showArchived ? 'No archived sources' : 'No tracked sources yet'}
          description="Add a YouTube, Twitch, or Kick channel above to start monitoring uploads and live streams."
        />
      ) : (
        <div className="space-y-2">
          {visibleSources.map((src) => {
            const syncAgeSec = src.lastSyncedAt
              ? Math.floor((Date.now() - Date.parse(src.lastSyncedAt)) / 1000)
              : null;
            return (
              <Card key={src.followId} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--text-secondary)]">
                      {src.platform}
                    </span>
                    <span className="truncate text-[13px] font-semibold text-[var(--text-strong)]">
                      {src.displayName || src.handle}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">
                      @{src.handle}
                    </span>
                    {src.groupName && (
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                        {src.groupName}
                      </span>
                    )}
                    {src.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                    Last synced: {syncAgeSec !== null ? formatAgeSeconds(syncAgeSec) : 'never'} ·
                    Source: /api/v1/sources
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={src.starred ? 'Unstar source' : 'Star priority source'}
                    onClick={() =>
                      patchMutation.mutate({
                        followId: src.followId,
                        patch: { starred: !src.starred },
                      })
                    }
                    className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border ${
                      src.starred
                        ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]'
                        : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
                    }`}
                  >
                    <Star className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    aria-label={src.paused ? 'Resume source' : 'Pause source'}
                    onClick={() =>
                      patchMutation.mutate({
                        followId: src.followId,
                        patch: { paused: !src.paused },
                      })
                    }
                    className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {src.paused ? (
                      <Play className="h-4 w-4" strokeWidth={1.5} />
                    ) : (
                      <Pause className="h-4 w-4" strokeWidth={1.5} />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={src.archived ? 'Restore source' : 'Archive source'}
                    onClick={() =>
                      patchMutation.mutate({
                        followId: src.followId,
                        patch: { archived: !src.archived },
                      })
                    }
                    className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--danger)]"
                  >
                    <Archive className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
