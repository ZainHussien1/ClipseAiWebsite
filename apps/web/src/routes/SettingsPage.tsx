import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { setAccountPassphrase } from '../lib/api';
import {
  ApiError,
  deleteWorkspace,
  exportWorkspace,
  listMembers,
  removeMember,
  updateMemberRole,
} from '../lib/api-v1';
import type { WorkspaceRole } from '../lib/contracts';

const ROLES: WorkspaceRole[] = ['Owner', 'Admin', 'Member', 'Viewer'];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmDeleteText, setConfirmDeleteText] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const membersQuery = useQuery({
    queryKey: ['settings', 'members'],
    queryFn: listMembers,
    retry: false,
  });

  const passphraseMutation = useMutation({
    mutationFn: () => setAccountPassphrase(passphrase),
    onSuccess: () => {
      setPassphrase('');
      setStatusMsg('Account passphrase updated.');
    },
    onError: (err) => {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to update passphrase');
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      updateMemberRole(userId, role),
    onSuccess: () => {
      setStatusMsg('Member role updated.');
      void queryClient.invalidateQueries({ queryKey: ['settings', 'members'] });
    },
    onError: (err) => {
      setStatusMsg(err instanceof ApiError ? err.message : 'Failed to update role');
    },
  });

  const removeMutation = useMutation({
    mutationFn: removeMember,
    onSuccess: () => {
      setStatusMsg('Member removed.');
      void queryClient.invalidateQueries({ queryKey: ['settings', 'members'] });
    },
    onError: (err) => {
      setStatusMsg(err instanceof ApiError ? err.message : 'Failed to remove member');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: () => {
      setStatusMsg('Workspace deleted.');
      setConfirmDeleteText('');
    },
    onError: (err) => {
      setStatusMsg(err instanceof ApiError ? err.message : 'Workspace delete failed');
    },
  });

  const handleExport = async (format: 'json' | 'csv') => {
    setStatusMsg(null);
    try {
      const blob = await exportWorkspace(format);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `clipse-workspace-export.${format}`;
      a.click();
      URL.revokeObjectURL(href);
      setStatusMsg(`Exported workspace as ${format.toUpperCase()}.`);
    } catch (err) {
      setStatusMsg(err instanceof ApiError ? err.message : 'Export failed');
    }
  };

  const members = membersQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Settings</h1>
        <p className="text-[12px] text-[var(--text-secondary)]">
          Account passphrase, workspace members, tenant-scoped export, and workspace deletion.
        </p>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[12px] text-[var(--text-primary)]">
          {statusMsg}
        </div>
      )}

      <Card className="p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.5} />
          <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
            Account Passphrase
          </h2>
        </div>
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
          Set a personal passphrase (min 8 characters) to sign in without requesting a Discord OTP.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (passphrase.length >= 8) passphraseMutation.mutate();
          }}
          className="mt-3 flex flex-wrap gap-2"
        >
          <input
            type="password"
            minLength={8}
            maxLength={128}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="New passphrase (min 8 chars)"
            aria-label="New account passphrase"
            className="min-h-[40px] min-w-[200px] flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)]"
          />
          <button
            type="submit"
            disabled={passphrase.length < 8 || passphraseMutation.isPending}
            className="min-h-[40px] rounded-lg bg-[var(--accent)] px-4 text-[12px] font-semibold text-[#0c1519] disabled:opacity-40"
          >
            {passphraseMutation.isPending ? 'Saving...' : 'Save Passphrase'}
          </button>
        </form>
      </Card>

      <Card className="p-4">
        <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
          Workspace Members &amp; Roles
        </h2>
        {membersQuery.isLoading ? (
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">Loading members...</p>
        ) : membersQuery.isError ? (
          <p className="mt-2 text-[12px] text-[var(--danger)]">
            {membersQuery.error instanceof Error
              ? membersQuery.error.message
              : 'Members require Admin or Owner role.'}
          </p>
        ) : members.length === 0 ? (
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">No members listed.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {members.map((m) => (
              <div
                key={m.userId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
              >
                <span className="text-[13px] text-[var(--text-primary)]">{m.email}</span>
                <div className="flex items-center gap-2">
                  <select
                    value={m.role}
                    onChange={(e) =>
                      roleMutation.mutate({
                        userId: m.userId,
                        role: e.target.value as WorkspaceRole,
                      })
                    }
                    aria-label={`Role for ${m.email}`}
                    className="min-h-[36px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-2.5 text-[12px] text-[var(--text-primary)]"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(m.userId)}
                    aria-label={`Remove ${m.email}`}
                    className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
          Workspace Data Export
        </h2>
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
          Download all workspace-scoped rows (follows, claims, clips, alerts, notifications).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleExport('json')}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--input-border)]"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void handleExport('csv')}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--input-border)]"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            Export CSV
          </button>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-[14px] font-semibold text-[var(--danger)]">
          Danger Zone — Delete Workspace
        </h2>
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
          Owner-only atomic purge of all tenant tables. Type DELETE to confirm.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="text"
            value={confirmDeleteText}
            onChange={(e) => setConfirmDeleteText(e.target.value)}
            placeholder="Type DELETE"
            aria-label="Confirm workspace deletion"
            className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)]"
          />
          <button
            type="button"
            disabled={confirmDeleteText !== 'DELETE' || deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
            className="min-h-[40px] rounded-lg px-4 text-[12px] font-semibold disabled:opacity-40"
            style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete Workspace'}
          </button>
        </div>
      </Card>
    </div>
  );
}
