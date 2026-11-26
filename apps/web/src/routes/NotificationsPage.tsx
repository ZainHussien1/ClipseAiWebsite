import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ApiError,
  listNotifications,
  markNotificationRead,
  registerPushSubscription,
  updateDiscordWebhook,
  updateNotificationPrefs,
} from '../lib/api-v1';
import type { NotificationPrefs, NotificationTier } from '../lib/contracts';

const DISCORD_WEBHOOK_REGEX =
  /^https:\/\/discord\.com\/api\/webhooks\/\d{10,30}\/[A-Za-z0-9._-]{20,128}$/;

const TIER_STYLE: Record<NotificationTier, { bg: string; color: string }> = {
  P1: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
  P2: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  P3: { bg: 'var(--accent-tint)', color: 'var(--accent)' },
};

function arrayBufferToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const notifQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: listNotifications,
  });

  const [hourlyBudget, setHourlyBudget] = useState(10);
  const [quietStart, setQuietStart] = useState<string>('');
  const [quietEnd, setQuietEnd] = useState<string>('');
  const [timezone, setTimezone] = useState(() =>
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
  );
  const [snoozeUntil, setSnoozeUntil] = useState<string | null>(null);
  const [prefsStatus, setPrefsStatus] = useState<string | null>(null);

  const [discordUrl, setDiscordUrl] = useState('');
  const [discordConfigured, setDiscordConfigured] = useState(false);
  const [discordMsg, setDiscordMsg] = useState<string | null>(null);

  const [pushMsg, setPushMsg] = useState<string | null>(null);

  useEffect(() => {
    const p = notifQuery.data?.prefs;
    if (!p) return;
    setHourlyBudget(p.hourlyBudget);
    setQuietStart(p.quietStartHour !== null ? String(p.quietStartHour) : '');
    setQuietEnd(p.quietEndHour !== null ? String(p.quietEndHour) : '');
    setTimezone(p.timezone);
    setSnoozeUntil(p.snoozeUntil);
  }, [notifQuery.data?.prefs]);

  const readMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const prefsMutation = useMutation({
    mutationFn: (prefs: NotificationPrefs) => updateNotificationPrefs(prefs),
    onSuccess: () => {
      setPrefsStatus('Preferences saved.');
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => {
      setPrefsStatus(err instanceof ApiError ? err.message : 'Failed to save preferences');
    },
  });

  const discordMutation = useMutation({
    mutationFn: (url: string | null) => updateDiscordWebhook(url),
    onSuccess: (res) => {
      setDiscordUrl('');
      setDiscordConfigured(res.configured);
      setDiscordMsg(res.configured ? 'Discord webhook saved (token hidden).' : 'Discord webhook cleared.');
    },
    onError: (err) => {
      setDiscordMsg(err instanceof ApiError ? err.message : 'Failed to update Discord webhook');
    },
  });

  const handleSavePrefs = (e: React.FormEvent, overrideSnooze?: string | null) => {
    e.preventDefault();
    setPrefsStatus(null);
    const hasStart = quietStart.trim() !== '';
    const hasEnd = quietEnd.trim() !== '';
    if (hasStart !== hasEnd) {
      setPrefsStatus('Set both quiet start and end hours, or leave both blank.');
      return;
    }
    const nextSnooze = overrideSnooze !== undefined ? overrideSnooze : snoozeUntil;
    setSnoozeUntil(nextSnooze);
    prefsMutation.mutate({
      hourlyBudget: Math.min(100, Math.max(1, Number(hourlyBudget) || 10)),
      quietStartHour: hasStart ? Number(quietStart) : null,
      quietEndHour: hasEnd ? Number(quietEnd) : null,
      timezone: timezone.trim() || 'UTC',
      snoozeUntil: nextSnooze,
    });
  };

  const handleSaveDiscord = (e: React.FormEvent) => {
    e.preventDefault();
    setDiscordMsg(null);
    const trimmed = discordUrl.trim();
    if (!DISCORD_WEBHOOK_REGEX.test(trimmed)) {
      setDiscordMsg('Enter a valid https://discord.com/api/webhooks/{id}/{token} URL.');
      return;
    }
    discordMutation.mutate(trimmed);
  };

  const handleEnablePush = async () => {
    setPushMsg(null);
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushMsg('Web Push is not supported in this browser context.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushMsg('Notification permission was not granted.');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setPushMsg('No active PushManager subscription (VAPID key required in environment).');
        return;
      }
      await registerPushSubscription({
        endpoint: sub.endpoint,
        keys: {
          p256dh: arrayBufferToBase64Url(sub.getKey('p256dh')),
          auth: arrayBufferToBase64Url(sub.getKey('auth')),
        },
      });
      setPushMsg('Web Push subscription registered.');
    } catch (err) {
      setPushMsg(err instanceof Error ? err.message : 'Push registration failed');
    }
  };

  const notifications = notifQuery.data?.notifications ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--text-strong)]">
          Notification Center
        </h1>
        <p className="text-[12px] text-[var(--text-secondary)]">
          P1/P2/P3 delivery inbox, quiet hours, hourly budget, Discord webhook, and Web Push.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
            Budget, Quiet Hours &amp; Snooze
          </h2>
          <form onSubmit={(e) => handleSavePrefs(e)} className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[12px] text-[var(--text-secondary)]">
                Hourly budget (1–100)
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={hourlyBudget}
                  onChange={(e) => setHourlyBudget(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-[13px] text-[var(--text-primary)]"
                />
              </label>
              <label className="text-[12px] text-[var(--text-secondary)]">
                Timezone
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-[13px] text-[var(--text-primary)]"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[12px] text-[var(--text-secondary)]">
                Quiet start hour (0–23)
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={quietStart}
                  onChange={(e) => setQuietStart(e.target.value)}
                  placeholder="Off"
                  className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-[13px] text-[var(--text-primary)]"
                />
              </label>
              <label className="text-[12px] text-[var(--text-secondary)]">
                Quiet end hour (0–23)
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(e.target.value)}
                  placeholder="Off"
                  className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 py-2 text-[13px] text-[var(--text-primary)]"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={prefsMutation.isPending}
                className="min-h-[38px] rounded-lg bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-[#0c1519]"
              >
                Save Preferences
              </button>
              <button
                type="button"
                onClick={(e) =>
                  handleSavePrefs(e, new Date(Date.now() + 3600_000).toISOString())
                }
                className="min-h-[38px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Snooze 1h
              </button>
              {snoozeUntil && (
                <button
                  type="button"
                  onClick={(e) => handleSavePrefs(e, null)}
                  className="min-h-[38px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] text-[var(--warning)]"
                >
                  Clear snooze
                </button>
              )}
            </div>
            {prefsStatus && (
              <p className="text-[12px] text-[var(--text-secondary)]">{prefsStatus}</p>
            )}
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
                Discord Webhook
              </h2>
              {discordConfigured && (
                <span className="rounded-full bg-[var(--success-bg)] px-2 py-0.5 text-[11px] text-[var(--success)]">
                  Configured (hidden)
                </span>
              )}
            </div>
            <form onSubmit={handleSaveDiscord} className="mt-3 flex flex-wrap gap-2">
              <input
                type="password"
                autoComplete="off"
                value={discordUrl}
                onChange={(e) => setDiscordUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                aria-label="Discord webhook URL"
                className="min-h-[40px] min-w-[200px] flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-3 text-[13px] text-[var(--text-primary)]"
              />
              <button
                type="submit"
                disabled={discordMutation.isPending}
                className="min-h-[40px] rounded-lg bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-[#0c1519]"
              >
                Save
              </button>
            </form>
            {discordMsg && (
              <p className="mt-2 text-[12px] text-[var(--text-secondary)]">{discordMsg}</p>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.5} />
                <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
                  Web Push &amp; iOS PWA
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void handleEnablePush()}
                className="min-h-[38px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--input-border)]"
              >
                Enable Web Push
              </button>
            </div>
            <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
              On iOS 16.4+, Web Push requires installing this app first: tap Share in Safari,
              select Add to Home Screen, then open Clipse Radar from your Home Screen.
            </p>
            {pushMsg && (
              <p className="mt-2 text-[12px] text-[var(--accent)]">{pushMsg}</p>
            )}
          </Card>
        </div>
      </div>

      {notifQuery.isLoading ? (
        <Card className="p-6 text-[12px] text-[var(--text-secondary)]">
          Loading notifications...
        </Card>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Inbox is clear"
          description="Delivered P1, P2, and P3 alerts appear here with read state and channel attribution."
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const tierStyle = TIER_STYLE[n.tier];
            return (
              <Card key={n.id} className="flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className="rounded px-1.5 py-0.5 font-semibold"
                      style={{ backgroundColor: tierStyle.bg, color: tierStyle.color }}
                    >
                      {n.tier}
                    </span>
                    <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--text-muted)]">
                      {n.channel}
                    </span>
                    {!n.readAt && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                    )}
                  </div>
                  <div className="mt-1 text-[13px] font-semibold text-[var(--text-strong)]">
                    {n.title}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{n.body}</div>
                </div>
                {!n.readAt && (
                  <button
                    type="button"
                    onClick={() => readMutation.mutate(n.id)}
                    aria-label="Mark notification as read"
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[11px] text-[var(--text-primary)]"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Read
                  </button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
