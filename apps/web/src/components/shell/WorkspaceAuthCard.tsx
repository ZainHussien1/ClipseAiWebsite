import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { bootstrapWorkspaceSession } from '../../lib/api';
import { Card } from '../ui/Card';

interface WorkspaceAuthCardProps {
  hasWorkspace: boolean;
}

export function WorkspaceAuthCard({ hasWorkspace }: WorkspaceAuthCardProps) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const authMutation = useMutation({
    mutationFn: () =>
      bootstrapWorkspaceSession(
        email.trim(),
        !hasWorkspace && workspaceName.trim() ? workspaceName.trim() : undefined,
      ),
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['auth', 'status'] });
      void queryClient.invalidateQueries({ queryKey: ['system', 'me'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim().includes('@')) {
      setErrorMsg('Enter a valid email address.');
      return;
    }
    authMutation.mutate();
  };

  return (
    <div className="mx-auto mt-10 max-w-md">
      <Card className="p-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-tint)] text-[var(--accent)]">
            <ShieldCheck className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-[16px] font-semibold text-[var(--text-strong)]">
              {hasWorkspace ? 'Sign in to Clipse Radar' : 'Create Workspace'}
            </h1>
            <p className="text-[12px] text-[var(--text-secondary)]">
              {hasWorkspace
                ? 'Enter your invited workspace member email.'
                : 'Initialize the first Owner workspace for this deployment.'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <label className="block text-[12px] text-[var(--text-secondary)]">
            Email address
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
              className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </label>

          {!hasWorkspace && (
            <label className="block text-[12px] text-[var(--text-secondary)]">
              Workspace name (optional)
              <input
                type="text"
                maxLength={64}
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Clipse Studio"
                className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </label>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-[12px]"
              style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}
            >
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={authMutation.isPending}
            className="min-h-[44px] w-full rounded-lg bg-[var(--accent)] px-4 text-[13px] font-semibold text-[#0c1519] disabled:opacity-50"
          >
            {authMutation.isPending
              ? 'Authenticating...'
              : hasWorkspace
                ? 'Sign In'
                : 'Create Workspace'}
          </button>
        </form>
      </Card>
    </div>
  );
}
