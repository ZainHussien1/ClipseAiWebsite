import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Download, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import {
  AdminHealthPanel,
  AuditLogPanel,
  DataQualityPanel,
} from '../components/ui/AdminPanels';
import { Card } from '../components/ui/Card';
import { IntegrationsPanel } from '../components/ui/IntegrationsPanel';
import { setAccountPassphrase } from '../lib/api';
import {
  ApiError,
  deleteWorkspace,
  exportWorkspace,
  inviteMember,
  listMembers,
  listSources,
  removeMember,
  updateMemberRole,
  updateSource,
} from '../lib/api-v1';
import type { WorkspaceRole } from '../lib/contracts';
import { normalizeHandle } from '../lib/url';

const ROLES: WorkspaceRole[] = ['Owner', 'Admin', 'Member', 'Viewer'];
type SettingsTab =
  | 'integrations'
  | 'members'
  | 'channels'
  | 'health'
  | 'audit'
  | 'quality'
  | 'account';

function initialTabFromUrl(): SettingsTab {
  if (typeof window === 'undefined') return 'integrations';
  const t = new URLSearchParams(window.location.search).get('tab');
  if (
    t === 'members' ||
    t === 'channels' ||
    t === 'health' ||
    t === 'audit' ||
    t === 'quality' ||
    t === 'account'
  ) {
    return t;
  }
  return 'integrations';
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SettingsTab>(initialTabFromUrl);
  const [statusMsg, setStatusMsg] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('status') === 'callback_ok') {
      return `OAuth callback received for ${qs.get('provider') ?? 'provider'}. Click Verify Connection to confirm.`;
    }
    return null;
  });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('Member');
  const [invitePass, setInvitePass] = useState('');
  const [confirmDeleteText, setConfirmDeleteText] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const membersQuery = useQuery({
    queryKey: ['settings', 'members'],
    queryFn: listMembers,
    enabled: tab === 'members',
    retry: false,
  });

  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: listSources,
    enabled: tab === 'channels',
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      inviteMember({
        email: inviteEmail.trim(),
        role: inviteRole,
        temporaryPassphrase: invitePass,
      }),
    onSuccess: (res) => {
      setInviteEmail('');
      setInvitePass('');
      setStatusMsg(`${res.message} (${res.seatsUsed}/${res.maxSeats} seats used)`);
      void queryClient.invalidateQueries({ queryKey: ['settings', 'members'] });
    },
    onError: (err) => setStatusMsg(err instanceof ApiError ? err.message : 'Invite failed'),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      updateMemberRole(userId, role),
    onSuccess: () => {
      setStatusMsg('Member role updated.');
      void queryClient.invalidateQueries({ queryKey: ['settings', 'members'] });
    },
    onError: (err) => setStatusMsg(err instanceof ApiError ? err.message : 'Failed to update role'),
  });

  const removeMutation = useMutation({
    mutationFn: removeMember,
    onSuccess: () => {
      setStatusMsg('Member removed.');
      void queryClient.invalidateQueries({ queryKey: ['settings', 'members'] });
    },
    onError: (err) => setStatusMsg(err instanceof ApiError ? err.message : 'Failed to remove member'),
  });

  const ownMutation = useMutation({
    mutationFn: ({ followId, isOwn }: { followId: string; isOwn: boolean }) =>
      updateSource(followId, { isOwn }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['sources'] }),
  });

  const passphraseMutation = useMutation({
    mutationFn: () => setAccountPassphrase(passphrase),
    onSuccess: () => {
      setPassphrase('');
      setStatusMsg('Account passphrase updated.');
    },
    onError: (err) => setStatusMsg(err instanceof Error ? err.message : 'Failed to update passphrase'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: () => {
      setStatusMsg('Workspace deleted.');
      setConfirmDeleteText('');
    },
    onError: (err) => setStatusMsg(err instanceof ApiError ? err.message : 'Workspace delete failed'),
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
  const ownerCount = members.filter((m) => m.role === 'Owner').length;
  const sources = sourcesQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">Settings</h1>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Integrations, 3-seat member allowlist, Our Channels, health, audit log, and data quality.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['integrations', 'Integrations'],
              ['members', 'Members'],
              ['channels', 'Our Channels'],
              ['health', 'Health & Accuracy'],
              ['audit', 'Audit Log'],
              ['quality', 'Data Quality'],
              ['account', 'Export & Danger Zone'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`min-h-[36px] rounded-lg border px-2.5 text-[12px] font-medium ${
                tab === key
                  ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--text-strong)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[12px] text-[var(--text-primary)]">
          {statusMsg}
        </div>
      )}

      {tab === 'integrations' && <IntegrationsPanel />}

      {tab === 'members' && (
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-strong)]">
              <UserPlus className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.5} />
              Invite Member (Max 3 Team Seats)
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                inviteMutation.mutate();
              }}
              className="mt-3 grid gap-2 sm:grid-cols-12"
            >
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="editor@studio.com"
                aria-label="Member email"
                className="min-h-[38px] min-w-0 rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px] sm:col-span-4"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                aria-label="Invite role"
                className="min-h-[38px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-2.5 text-[12px] sm:col-span-2"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                type="password"
                required
                minLength={8}
                value={invitePass}
                onChange={(e) => setInvitePass(e.target.value)}
                placeholder="Temp passphrase (min 8 chars)"
                aria-label="Temporary passphrase"
                className="min-h-[38px] min-w-0 rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[12px] sm:col-span-4"
              />
              <button
                type="submit"
                disabled={inviteMutation.isPending}
                className="min-h-[38px] rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-[#0c1519] sm:col-span-2"
              >
                Invite
              </button>
            </form>
          </Card>

          <Card className="p-4">
            <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
              Workspace Members ({members.length}/3)
            </h2>
            {membersQuery.isLoading ? (
              <p className="mt-2 text-[12px] text-[var(--text-secondary)]">Loading members...</p>
            ) : membersQuery.isError ? (
              <p className="mt-2 text-[12px] text-[var(--danger)]">
                {membersQuery.error instanceof Error
                  ? membersQuery.error.message
                  : 'Members require Admin or Owner role.'}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {members.map((m) => {
                  const isSoleOwner = m.role === 'Owner' && ownerCount <= 1;
                  return (
                    <div
                      key={m.userId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
                    >
                      <span className="text-[13px] text-[var(--text-primary)]">{m.email}</span>
                      <div className="flex items-center gap-2">
                        <select
                          value={m.role}
                          disabled={isSoleOwner}
                          title={isSoleOwner ? 'Sole Owner cannot be demoted' : undefined}
                          onChange={(e) =>
                            roleMutation.mutate({ userId: m.userId, role: e.target.value as WorkspaceRole })
                          }
                          aria-label={`Role for ${m.email}`}
                          className="min-h-[36px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-2.5 text-[12px] disabled:opacity-50"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={isSoleOwner}
                          title={isSoleOwner ? 'Sole Owner cannot be removed' : 'Remove member'}
                          onClick={() => removeMutation.mutate(m.userId)}
                          aria-label={`Remove ${m.email}`}
                          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--danger)] disabled:opacity-30"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'channels' && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
              Our Channels (is_own)
            </h2>
            <Link to="/sources" className="text-[12px] font-medium text-[var(--accent)]">
              Manage Sources
            </Link>
          </div>
          {sources.length === 0 ? (
            <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
              Add channels in Sources first, then mark your clip channels here.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {sources.map((ch) => (
                <label
                  key={ch.followId}
                  className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12px]"
                >
                  <span>
                    <span className="font-semibold uppercase text-[var(--text-secondary)]">
                      {ch.platform}
                    </span>{' '}
                    · {ch.displayName || normalizeHandle(ch.handle)}
                  </span>
                  <input
                    type="checkbox"
                    checked={ch.isOwn}
                    onChange={(e) => ownMutation.mutate({ followId: ch.followId, isOwn: e.target.checked })}
                    className="accent-[var(--accent)]"
                  />
                </label>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'health' && <AdminHealthPanel />}
      {tab === 'audit' && <AuditLogPanel />}
      {tab === 'quality' && <DataQualityPanel />}

      {tab === 'account' && (
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-strong)]">
              <KeyRound className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.5} />
              Account Passphrase
            </h2>
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
                className="min-h-[40px] min-w-[200px] flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px]"
              />
              <button
                type="submit"
                disabled={passphrase.length < 8 || passphraseMutation.isPending}
                className="min-h-[40px] rounded-lg bg-[var(--accent)] px-4 text-[12px] font-semibold text-[#0c1519] disabled:opacity-40"
              >
                Save Passphrase
              </button>
            </form>
          </Card>

          <Card className="p-4">
            <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
              Workspace Data Export
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleExport('json')}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-[12px]"
              >
                <Download className="h-3.5 w-3.5" />
                Export JSON
              </button>
              <button
                type="button"
                onClick={() => void handleExport('csv')}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-[12px]"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-[14px] font-semibold text-[var(--danger)]">
              Danger Zone — Delete Workspace
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="text"
                value={confirmDeleteText}
                onChange={(e) => setConfirmDeleteText(e.target.value)}
                placeholder="Type DELETE"
                aria-label="Confirm workspace deletion"
                className="min-h-[40px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px]"
              />
              <button
                type="button"
                disabled={confirmDeleteText !== 'DELETE' || deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                className="min-h-[40px] rounded-lg px-4 text-[12px] font-semibold disabled:opacity-40"
                style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
              >
                Delete Workspace
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
