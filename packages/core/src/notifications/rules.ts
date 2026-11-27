import { z } from 'zod';
import {
  alertConfidenceSchema,
  alertTypeSchema,
  DISCORD_WEBHOOK_REGEX,
  notificationTierSchema,
  type AlertConfidence,
  type AlertType,
  type NotificationPrefs,
  type NotificationTier,
  type RisingTier,
  type SourceRule,
} from '../api-schemas.js';

export const notifyQueueMessageSchema = z.object({
  type: z.literal('dispatch_alert'),
  idempotencyKey: z.string().min(1).max(256),
  workspaceId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
  alertId: z.string().min(1).max(128),
  alertType: alertTypeSchema,
  confidence: alertConfidenceSchema,
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(1000),
  deepLinkUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'))
    .optional(),
  isEscalation: z.boolean().optional().default(false),
  sourceRule: z
    .object({
      minRisingLevel: z.enum(['rising', 'breakout', 'viral']).default('rising'),
      notifyLive: z.boolean().default(true),
      notifyUploads: z.boolean().default(true),
      muted: z.boolean().default(false),
    })
    .optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export type NotifyQueueMessage = z.infer<typeof notifyQueueMessageSchema>;

export type SuppressionReason =
  | 'source_muted'
  | 'source_live_disabled'
  | 'source_uploads_disabled'
  | 'below_min_rising_level'
  | 'duplicate'
  | 'snoozed'
  | 'quiet_hours'
  | 'hourly_budget_exceeded';

export interface NotificationEvaluationInput {
  readonly alertType: AlertType;
  readonly confidence: AlertConfidence;
  readonly isEscalation?: boolean;
  readonly tierOverride?: NotificationTier;
  readonly sourceRule?: SourceRule;
  readonly prefs: NotificationPrefs;
  readonly sentLastHourCount: number;
  readonly dedupeKey: string;
  readonly recentDedupeKeys: ReadonlySet<string> | readonly string[];
  readonly nowIso: string;
}

export interface NotificationEvaluationResult {
  readonly tier: NotificationTier;
  readonly allowed: boolean;
  readonly deliverInApp: boolean;
  readonly deliverDiscord: boolean;
  readonly deliverWebPush: boolean;
  readonly suppressedReasons: readonly SuppressionReason[];
}

const RISING_RANK: Record<RisingTier, number> = {
  none: 0,
  rising: 1,
  breakout: 2,
  viral: 3,
};

/**
 * Maps an alert type and confidence to a default notification tier (P1 | P2 | P3).
 */
export function resolveAlertTier(
  alertType: AlertType,
  confidence: AlertConfidence,
  isEscalation = false,
): NotificationTier {
  if (isEscalation || alertType === 'viral') return 'P1';
  if (alertType === 'live_moment') {
    if (confidence === 'high') return 'P1';
    if (confidence === 'medium') return 'P2';
    return 'P3';
  }
  if (alertType === 'breakout' || alertType === 'vod_ready') return 'P2';
  return 'P3';
}

function getLocalHourInTimezone(nowMs: number, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date(nowMs));
    const hourPart = parts.find((p) => p.type === 'hour')?.value;
    const parsed = Number(hourPart);
    if (Number.isInteger(parsed)) {
      return parsed === 24 ? 0 : parsed;
    }
  } catch {
    // Invalid IANA timezone falls back to UTC
  }
  return new Date(nowMs).getUTCHours();
}

/**
 * Checks whether the current timestamp falls within [quietStartHour, quietEndHour)
 * in the user's IANA timezone. Handles midnight wrap-around (e.g. 23 -> 7).
 */
export function isWithinQuietHours(
  nowIso: string,
  quietStartHour: number | null,
  quietEndHour: number | null,
  timezone: string,
): boolean {
  if (quietStartHour === null || quietEndHour === null) return false;
  if (quietStartHour === quietEndHour) return false;
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return false;

  const hour = getLocalHourInTimezone(nowMs, timezone);
  if (quietStartHour < quietEndHour) {
    return hour >= quietStartHour && hour < quietEndHour;
  }
  return hour >= quietStartHour || hour < quietEndHour;
}

function checkSourceRule(
  alertType: AlertType,
  rule?: SourceRule,
): SuppressionReason | null {
  if (!rule) return null;
  if (rule.muted) return 'source_muted';

  const isLiveAlert = alertType === 'live_moment' || alertType === 'vod_ready';
  if (isLiveAlert && !rule.notifyLive) return 'source_live_disabled';

  const isRisingAlert =
    alertType === 'rising' || alertType === 'breakout' || alertType === 'viral';
  if (isRisingAlert) {
    if (!rule.notifyUploads) return 'source_uploads_disabled';
    if (RISING_RANK[alertType] < RISING_RANK[rule.minRisingLevel]) {
      return 'below_min_rising_level';
    }
  }
  return null;
}

/**
 * Pure notification policy evaluator: enforces source rules, dedupe, snooze,
 * TZ-aware quiet hours, and per-user hourly budget.
 */
export function evaluateNotification(
  input: NotificationEvaluationInput,
): NotificationEvaluationResult {
  const tier =
    input.tierOverride ??
    resolveAlertTier(input.alertType, input.confidence, input.isEscalation ?? false);

  const suppressedReasons: SuppressionReason[] = [];
  const sourceReason = checkSourceRule(input.alertType, input.sourceRule);
  if (sourceReason) suppressedReasons.push(sourceReason);

  const isDuplicate = Array.isArray(input.recentDedupeKeys)
    ? input.recentDedupeKeys.includes(input.dedupeKey)
    : (input.recentDedupeKeys as ReadonlySet<string>).has(input.dedupeKey);
  if (isDuplicate) suppressedReasons.push('duplicate');

  const nowMs = Date.parse(input.nowIso);
  if (input.prefs.snoozeUntil) {
    const snoozeMs = Date.parse(input.prefs.snoozeUntil);
    if (Number.isFinite(snoozeMs) && Number.isFinite(nowMs) && snoozeMs > nowMs) {
      suppressedReasons.push('snoozed');
    }
  }

  if (suppressedReasons.length > 0) {
    return {
      tier,
      allowed: false,
      deliverInApp: false,
      deliverDiscord: false,
      deliverWebPush: false,
      suppressedReasons,
    };
  }

  const inQuietHours = isWithinQuietHours(
    input.nowIso,
    input.prefs.quietStartHour,
    input.prefs.quietEndHour,
    input.prefs.timezone,
  );
  if (inQuietHours) suppressedReasons.push('quiet_hours');

  if (input.sentLastHourCount >= input.prefs.hourlyBudget) {
    suppressedReasons.push('hourly_budget_exceeded');
  }

  const externalAllowed = suppressedReasons.length === 0;
  return {
    tier,
    allowed: externalAllowed,
    deliverInApp: true,
    deliverDiscord: externalAllowed,
    deliverWebPush: externalAllowed,
    suppressedReasons,
  };
}

export type DiscordWebhookValidation =
  | { readonly valid: true; readonly url: string }
  | { readonly valid: false; readonly error: string };

/**
 * Strictly validates that a Discord webhook URL matches
 * https://discord.com/api/webhooks/{id}/{token} with no other hosts or params.
 */
export function validateDiscordWebhookUrl(rawUrl: string): DiscordWebhookValidation {
  const trimmed = rawUrl.trim();
  if (!DISCORD_WEBHOOK_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: 'Webhook URL must match https://discord.com/api/webhooks/{id}/{token}',
    };
  }
  return { valid: true, url: trimmed };
}

/**
 * Escapes Discord markdown and neutralizes mention-injection sequences
 * (@everyone, @here, <@user>, <@&role>, <#channel>) and control characters.
 */
export function escapeDiscordMarkdown(text: string): string {
  const withoutControls = Array.from(text)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join('');

  return withoutControls
    .replace(/@(everyone|here)/gi, '@\u200b$1')
    .replace(/<(@!?|@&|#)(\d+)>/g, '<$1\u200b$2>')
    .replace(/([\\*_~`|>[\]])/g, '\\$1');
}

export { notificationTierSchema };
export * from './on-shift.js';
