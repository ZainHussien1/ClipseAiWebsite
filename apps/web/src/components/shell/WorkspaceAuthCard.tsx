import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { loginWorkspaceSession, requestAuthCode } from '../../lib/api';
import { Card } from '../ui/Card';

interface WorkspaceAuthCardProps {
  hasWorkspace: boolean;
}

type AuthTab = 'code' | 'passphrase';

export function WorkspaceAuthCard({ hasWorkspace }: WorkspaceAuthCardProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AuthTab>('code');
  const [email, setEmail] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [code, setCode] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const requestCodeMutation = useMutation({
    mutationFn: () => requestAuthCode(email.trim()),
    onSuccess: (res) => {
      setErrorMsg(null);
      setInfoMsg(res.message);
    },
    onError: (err) => {
      setInfoMsg(null);
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send code');
    },
  });

  const loginMutation = useMutation({
    mutationFn: () =>
      loginWorkspaceSession({
        email: email.trim(),
        ...(workspaceName.trim() && !hasWorkspace ? { workspaceName: workspaceName.trim() } : {}),
        ...(tab === 'code' ? { code: code.trim() } : { passphrase }),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['auth', 'status'] });
      void queryClient.invalidateQueries({ queryKey: ['system', 'me'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['live'] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed');
    },
  });

  const handleRequestCode = () => {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email.trim().includes('@')) {
      setErrorMsg('Enter a valid email address first.');
      return;
    }
    requestCodeMutation.mutate();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim().includes('@')) {
      setErrorMsg('Enter a valid email address.');
      return;
    }
    if (tab === 'code' && !/^\d{6}$/.test(code.trim())) {
      setErrorMsg('Enter the 6-digit verification code.');
      return;
    }
    if (tab === 'passphrase' && passphrase.length < 8) {
      setErrorMsg('Passphrase must be at least 8 characters.');
      return;
    }
    loginMutation.mutate();
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
                ? 'Verify with a 6-digit Discord OTP or your passphrase.'
                : 'Initialize the Owner workspace with a verified code or passphrase.'}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1">
          <button
            type="button"
            onClick={() => {
              setTab('code');
              setErrorMsg(null);
            }}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md text-[12px] font-medium ${
              tab === 'code'
                ? 'bg-[var(--accent-tint)] text-[var(--text-strong)]'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={1.5} />
            6-Digit Code
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('passphrase');
              setErrorMsg(null);
            }}
            className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md text-[12px] font-medium ${
              tab === 'passphrase'
                ? 'bg-[var(--accent-tint)] text-[var(--text-strong)]'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" strokeWidth={1.5} />
            Passphrase
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block text-[12px] text-[var(--text-secondary)]">
            Email address
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@studio.com"
              className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </label>

          {!hasWorkspace && (
            <label className="block text-[12px] text-[var(--text-secondary)]">
              Workspace name (optional)
              <input
                type="text"
                maxLength={80}
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Clipse Studio"
                className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </label>
          )}

          {tab === 'code' ? (
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={requestCodeMutation.isPending}
                onClick={handleRequestCode}
                className="min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--accent)] disabled:opacity-50"
              >
                {requestCodeMutation.isPending
                  ? 'Sending verification code...'
                  : 'Send 6-digit verification code'}
              </button>
              <label className="block text-[12px] text-[var(--text-secondary)]">
                6-digit verification code
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2.5 font-mono text-[13px] tracking-widest text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </label>
            </div>
          ) : (
            <label className="block text-[12px] text-[var(--text-secondary)]">
              Passphrase (min 8 characters)
              <input
                type="password"
                minLength={8}
                maxLength={128}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase"
                className="mt-1 min-h-[44px] w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </label>
          )}

          {infoMsg && (
            <div
              role="status"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-[12px]"
              style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)' }}
            >
              {infoMsg}
            </div>
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
            disabled={loginMutation.isPending}
            className="min-h-[44px] w-full rounded-lg bg-[var(--accent)] px-4 text-[13px] font-semibold text-[#0c1519] disabled:opacity-50"
          >
            {loginMutation.isPending
              ? 'Verifying...'
              : hasWorkspace
                ? 'Sign In'
                : 'Create Workspace'}
          </button>
        </form>
      </Card>
    </div>
  );
}
