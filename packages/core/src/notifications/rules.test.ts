import { describe, expect, it } from 'vitest';
import {
  escapeDiscordMarkdown,
  evaluateNotification,
  filterOnShiftRecipients,
  isMemberOnShift,
  isWithinQuietHours,
  resolveAlertTier,
  validateDiscordWebhookUrl,
} from './rules.js';

const basePrefs = {
  hourlyBudget: 10,
  quietStartHour: null,
  quietEndHour: null,
  timezone: 'UTC',
  snoozeUntil: null,
};

describe('resolveAlertTier', () => {
  it('maps alerts to P1, P2, P3 tiers', () => {
    expect(resolveAlertTier('live_moment', 'high')).toBe('P1');
    expect(resolveAlertTier('viral', 'medium')).toBe('P1');
    expect(resolveAlertTier('rising', 'low', true)).toBe('P1');
    expect(resolveAlertTier('breakout', 'medium')).toBe('P2');
    expect(resolveAlertTier('vod_ready', 'medium')).toBe('P2');
    expect(resolveAlertTier('rising', 'low')).toBe('P3');
  });
});

describe('isWithinQuietHours', () => {
  it('handles wrap-around quiet hours in user timezone', () => {
    // 04:30 UTC is 23:30 America/New_York (EST, UTC-5) -> inside 23..7
    expect(isWithinQuietHours('2026-01-15T04:30:00Z', 23, 7, 'America/New_York')).toBe(true);
    // 13:30 UTC is 08:30 America/New_York -> outside 23..7
    expect(isWithinQuietHours('2026-01-15T13:30:00Z', 23, 7, 'America/New_York')).toBe(false);
    // Same-day range 01..06 UTC
    expect(isWithinQuietHours('2026-01-15T03:00:00Z', 1, 6, 'UTC')).toBe(true);
    expect(isWithinQuietHours('2026-01-15T06:00:00Z', 1, 6, 'UTC')).toBe(false);
  });
});

describe('evaluateNotification', () => {
  it('suppresses muted sources, disabled types, and below-threshold rising alerts', () => {
    const muted = evaluateNotification({
      alertType: 'viral',
      confidence: 'high',
      sourceRule: { minRisingLevel: 'rising', notifyLive: true, notifyUploads: true, muted: true },
      prefs: basePrefs,
      sentLastHourCount: 0,
      dedupeKey: 'k1',
      recentDedupeKeys: new Set(),
      nowIso: '2026-11-26T12:00:00Z',
    });
    expect(muted.allowed).toBe(false);
    expect(muted.deliverInApp).toBe(false);
    expect(muted.suppressedReasons).toContain('source_muted');

    const belowThreshold = evaluateNotification({
      alertType: 'rising',
      confidence: 'medium',
      sourceRule: {
        minRisingLevel: 'breakout',
        notifyLive: true,
        notifyUploads: true,
        muted: false,
      },
      prefs: basePrefs,
      sentLastHourCount: 0,
      dedupeKey: 'k2',
      recentDedupeKeys: new Set(),
      nowIso: '2026-11-26T12:00:00Z',
    });
    expect(belowThreshold.allowed).toBe(false);
    expect(belowThreshold.suppressedReasons).toContain('below_min_rising_level');
  });

  it('suppresses duplicates and active snooze', () => {
    const dup = evaluateNotification({
      alertType: 'breakout',
      confidence: 'medium',
      prefs: basePrefs,
      sentLastHourCount: 0,
      dedupeKey: 'alert-1',
      recentDedupeKeys: new Set(['alert-1']),
      nowIso: '2026-11-26T12:00:00Z',
    });
    expect(dup.allowed).toBe(false);
    expect(dup.suppressedReasons).toContain('duplicate');

    const snoozed = evaluateNotification({
      alertType: 'breakout',
      confidence: 'medium',
      prefs: { ...basePrefs, snoozeUntil: '2026-11-26T13:00:00Z' },
      sentLastHourCount: 0,
      dedupeKey: 'alert-2',
      recentDedupeKeys: new Set(),
      nowIso: '2026-11-26T12:00:00Z',
    });
    expect(snoozed.allowed).toBe(false);
    expect(snoozed.suppressedReasons).toContain('snoozed');
  });

  it('suppresses external push/Discord during quiet hours and hourly budget exhaustion while keeping in-app', () => {
    const overBudget = evaluateNotification({
      alertType: 'live_moment',
      confidence: 'high',
      prefs: { ...basePrefs, hourlyBudget: 5 },
      sentLastHourCount: 5,
      dedupeKey: 'alert-3',
      recentDedupeKeys: new Set(),
      nowIso: '2026-11-26T12:00:00Z',
    });
    expect(overBudget.allowed).toBe(false);
    expect(overBudget.deliverInApp).toBe(true);
    expect(overBudget.deliverDiscord).toBe(false);
    expect(overBudget.deliverWebPush).toBe(false);
    expect(overBudget.suppressedReasons).toContain('hourly_budget_exceeded');
  });
});

describe('validateDiscordWebhookUrl & escapeDiscordMarkdown', () => {
  it('accepts only https://discord.com/api/webhooks/{id}/{token}', () => {
    expect(
      validateDiscordWebhookUrl(
        'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456',
      ).valid,
    ).toBe(true);
    expect(
      validateDiscordWebhookUrl(
        'https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456',
      ).valid,
    ).toBe(false);
    expect(
      validateDiscordWebhookUrl(
        'http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456',
      ).valid,
    ).toBe(false);
  });

  it('escapes @everyone, @here, role/user mentions, and markdown', () => {
    const escaped = escapeDiscordMarkdown('Hey @everyone @here <@&12345> **bold** [link](x)\x00');
    expect(escaped).not.toContain('@everyone');
    expect(escaped).not.toContain('@here');
    expect(escaped).not.toContain('<@&12345>');
    expect(escaped).toContain('@\u200beveryone');
    expect(escaped).toContain('@\u200bhere');
    expect(escaped).toContain('<@&\u200b12345\\>');
    expect(escaped).toContain('\\*\\*bold\\*\\*');
    expect(escaped).not.toContain('\x00');
  });
});

describe('on-shift routing', () => {
  it('evaluates member availability in member timezone and routes P1 on-shift first with all-member fallback', () => {
    // 2026-11-26 is Thursday (day 4). 15:00Z = 10:00 America/New_York
    const nowIso = '2026-11-26T15:00:00Z';
    const nySchedule = JSON.stringify({
      timezone: 'America/New_York',
      schedule: [{ day: 4, startHour: 9, endHour: 17, enabled: true }],
    });
    const tokyoSchedule = JSON.stringify({
      timezone: 'Asia/Tokyo',
      // 15:00Z = 00:00 Friday (day 5) in Tokyo -> off shift for 9..17
      schedule: [{ day: 5, startHour: 9, endHour: 17, enabled: true }],
    });

    expect(isMemberOnShift(nySchedule, 'America/New_York', nowIso)).toBe(true);
    expect(isMemberOnShift(tokyoSchedule, 'Asia/Tokyo', nowIso)).toBe(false);
    expect(isMemberOnShift('{}', 'UTC', nowIso)).toBe(true);

    const routed = filterOnShiftRecipients(
      [
        { userId: 'u-ny', availabilityJson: nySchedule, timezone: 'America/New_York' },
        { userId: 'u-tk', availabilityJson: tokyoSchedule, timezone: 'Asia/Tokyo' },
      ],
      nowIso,
    );
    expect(routed.usedFallback).toBe(false);
    expect(routed.primaryRecipients.map((m) => m.userId)).toEqual(['u-ny']);
    expect(routed.offShiftRecipients.map((m) => m.userId)).toEqual(['u-tk']);

    const fallback = filterOnShiftRecipients(
      [{ userId: 'u-tk', availabilityJson: tokyoSchedule, timezone: 'Asia/Tokyo' }],
      nowIso,
    );
    expect(fallback.usedFallback).toBe(true);
    expect(fallback.primaryRecipients.map((m) => m.userId)).toEqual(['u-tk']);
    expect(fallback.offShiftRecipients).toEqual([]);
  });
});
