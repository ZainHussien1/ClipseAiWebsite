import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  fetchMemberAvailability,
  listNotificationDeliveries,
  sendTestNotification,
  updateMemberAvailability,
} from '../../lib/api-v1';
import type {
  AlertRulesMap,
  AlertType,
  MemberAvailabilityWindow,
  NotificationChannel,
  NotificationTier,
} from '../../lib/contracts';
import { Card } from './Card';

const ALERT_TYPES: AlertType[] = ['rising', 'breakout', 'viral', 'live_moment', 'vod_ready'];
const TIERS: NotificationTier[] = ['P1', 'P2', 'P3'];
const CHANNELS: NotificationChannel[] = ['in_app', 'discord', 'webpush'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Bucharest',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export function getIanaTimezoneOptions(extra?: string): string[] {
  const local =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const supported =
    typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
      ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
          'timeZone',
        )
      : FALLBACK_TIMEZONES;
  const set = new Set<string>([local, 'UTC', ...supported]);
  if (extra) set.add(extra);
  return [...set];
}

export function defaultRulesMap(): AlertRulesMap {
  return {
    rising: { tier: 'P2', channels: ['in_app'] },
    breakout: { tier: 'P1', channels: ['in_app', 'discord'] },
    viral: { tier: 'P1', channels: ['in_app', 'discord', 'webpush'] },
    live_moment: { tier: 'P1', channels: ['in_app', 'discord'] },
    vod_ready: { tier: 'P3', channels: ['in_app'] },
  };
}

function defaultSchedule(): MemberAvailabilityWindow[] {
  return WEEKDAYS.map((_, day) => ({
    day,
    startHour: 9,
    endHour: 18,
    enabled: day >= 1 && day <= 5,
  }));
}

export function RulesMatrixCard({
  rules,
  onChange,
}: {
  rules: AlertRulesMap;
  onChange: (next: AlertRulesMap) => void;
}) {
  const toggleChannel = (type: AlertType, ch: NotificationChannel) => {
    const entry = rules[type];
    const has = entry.channels.includes(ch);
    const nextChannels = has
      ? entry.channels.filter((c) => c !== ch)
      : [...entry.channels, ch];
    onChange({ ...rules, [type]: { ...entry, channels: nextChannels } });
  };

  return (
    <Card className="p-4">
      <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
        Alert Rules Matrix (Type &times; Tier &times; Channel)
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="border-b border-[var(--divider)] text-[11px] text-[var(--text-muted)]">
            <tr>
              <th className="py-2">Alert Type</th>
              <th className="py-2">Tier</th>
              <th className="py-2">Channels</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--divider)]">
            {ALERT_TYPES.map((type) => {
              const entry = rules[type];
              return (
                <tr key={type}>
                  <td className="py-2 font-medium capitalize text-[var(--text-primary)]">
                    {type.replace('_', ' ')}
                  </td>
                  <td className="py-2">
                    <select
                      value={entry.tier}
                      aria-label={`Tier for ${type}`}
                      onChange={(e) =>
                        onChange({
                          ...rules,
                          [type]: { ...entry, tier: e.target.value as NotificationTier },
                        })
                      }
                      className="rounded border border-[var(--input-border)] bg-[var(--input)] px-2 py-1 text-[12px]"
                    >
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      {CHANNELS.map((ch) => (
                        <label key={ch} className="inline-flex items-center gap-1 text-[11px]">
                          <input
                            type="checkbox"
                            checked={entry.channels.includes(ch)}
                            onChange={() => toggleChannel(type, ch)}
                            className="accent-[var(--accent)]"
                          />
                          <span>{ch}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function TestAndDeliverySection() {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<string | null>(null);
  const deliveriesQuery = useQuery({
    queryKey: ['notifications', 'deliveries'],
    queryFn: listNotificationDeliveries,
  });

  const testMutation = useMutation({
    mutationFn: sendTestNotification,
    onSuccess: (res, ch) => {
      setTestResult(`${ch}: ${res.message ?? res.detail ?? res.status ?? 'sent'}`);
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err, ch) => {
      setTestResult(`${ch} failed: ${err instanceof ApiError ? err.message : 'Error'}`);
    },
  });

  const deliveries = deliveriesQuery.data ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
              Test Notifications
            </h2>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Send 1 safe test notification and record it in the delivery log.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['in_app', 'discord', 'webpush'] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                disabled={testMutation.isPending}
                onClick={() => testMutation.mutate(ch)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--accent)]"
              >
                <Send className="h-3.5 w-3.5" strokeWidth={1.5} />
                Test {ch}
              </button>
            ))}
          </div>
        </div>
        {testResult && (
          <p className="mt-2.5 text-[12px] text-[var(--accent)]" role="status">
            {testResult}
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
          Delivery Log ({deliveries.length})
        </h2>
        {deliveries.length === 0 ? (
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
            No deliveries recorded yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="border-b border-[var(--divider)] text-[11px] text-[var(--text-muted)]">
                <tr>
                  <th className="py-2">Channel</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Reason</th>
                  <th className="py-2">Attempted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--divider)]">
                {deliveries.slice(0, 20).map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 font-mono">{d.channel}</td>
                    <td className="py-2">{d.status}</td>
                    <td className="py-2 text-[var(--text-secondary)]">{d.reason ?? 'ok'}</td>
                    <td className="py-2 font-mono text-[11px] text-[var(--text-muted)]">
                      {d.attemptedAt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function OnShiftScheduleCard() {
  const queryClient = useQueryClient();
  const availQuery = useQuery({
    queryKey: ['settings', 'availability'],
    queryFn: fetchMemberAvailability,
  });

  const [tz, setTz] = useState(() =>
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
  );
  const [schedule, setSchedule] = useState<MemberAvailabilityWindow[]>(defaultSchedule);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!availQuery.data) return;
    if (availQuery.data.timezone) setTz(availQuery.data.timezone);
    if (availQuery.data.schedule.length > 0) setSchedule(availQuery.data.schedule);
  }, [availQuery.data]);

  const tzOptions = useMemo(() => getIanaTimezoneOptions(tz), [tz]);

  const saveMutation = useMutation({
    mutationFn: () => updateMemberAvailability({ timezone: tz, schedule }),
    onSuccess: () => {
      setMsg('On-shift availability saved.');
      void queryClient.invalidateQueries({ queryKey: ['settings', 'availability'] });
    },
    onError: (err) => setMsg(err instanceof ApiError ? err.message : 'Save failed'),
  });

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--text-strong)]">
            On-Shift Availability Schedule
          </h2>
          <p className="text-[12px] text-[var(--text-secondary)]">
            P1 alerts route to on-shift members first in your local timezone.
          </p>
        </div>
        <select
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          aria-label="Member shift timezone"
          className="min-h-[36px] rounded-lg border border-[var(--input-border)] bg-[var(--input)] px-2.5 text-[12px]"
        >
          {tzOptions.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {schedule.map((w, idx) => (
          <div
            key={w.day}
            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11px]"
          >
            <label className="flex items-center gap-1.5 font-medium">
              <input
                type="checkbox"
                checked={w.enabled}
                onChange={(e) =>
                  setSchedule((prev) =>
                    prev.map((row, i) => (i === idx ? { ...row, enabled: e.target.checked } : row)),
                  )
                }
                className="accent-[var(--accent)]"
              />
              {WEEKDAYS[w.day]}
            </label>
            <div className="flex items-center gap-1 font-mono">
              <input
                type="number"
                min={0}
                max={23}
                value={w.startHour}
                aria-label={`${WEEKDAYS[w.day]} start hour`}
                onChange={(e) =>
                  setSchedule((prev) =>
                    prev.map((row, i) =>
                      i === idx ? { ...row, startHour: Number(e.target.value) } : row,
                    ),
                  )
                }
                className="w-11 rounded border border-[var(--input-border)] bg-[var(--input)] px-1 py-0.5 text-center"
              />
              <span>-</span>
              <input
                type="number"
                min={1}
                max={24}
                value={w.endHour}
                aria-label={`${WEEKDAYS[w.day]} end hour`}
                onChange={(e) =>
                  setSchedule((prev) =>
                    prev.map((row, i) =>
                      i === idx ? { ...row, endHour: Number(e.target.value) } : row,
                    ),
                  )
                }
                className="w-11 rounded border border-[var(--input-border)] bg-[var(--input)] px-1 py-0.5 text-center"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          className="min-h-[38px] rounded-lg bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-[#0c1519]"
        >
          Save Schedule
        </button>
        {msg && <span className="text-[12px] text-[var(--text-secondary)]">{msg}</span>}
      </div>
    </Card>
  );
}
