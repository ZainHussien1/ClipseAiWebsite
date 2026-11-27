import { z } from 'zod';
import {
  notificationChannelSchema,
  notificationTierSchema,
} from './api-schemas.js';

export function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const ianaTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidIanaTimezone, { message: 'Must be a valid IANA timezone' });

export const alertDeliveryStatusSchema = z.enum([
  'detected',
  'queued',
  'delivered',
  'suppressed',
  'failed',
]);
export type AlertDeliveryStatus = z.infer<typeof alertDeliveryStatusSchema>;

export const alertDeliverySchema = z.object({
  id: z.string(),
  alertId: z.string().nullable(),
  channel: z.string(),
  status: alertDeliveryStatusSchema,
  reason: z.string().nullable(),
  attemptedAt: z.string(),
  deliveredAt: z.string().nullable(),
});
export type AlertDeliveryRecord = z.infer<typeof alertDeliverySchema>;

export const acknowledgeAlertSchema = z.object({
  note: z.string().trim().max(300).optional(),
});
export type AcknowledgeAlertInput = z.infer<typeof acknowledgeAlertSchema>;

export const alertRuleEntrySchema = z.object({
  tier: notificationTierSchema,
  channels: z.array(notificationChannelSchema),
});

export const alertRulesMapSchema = z.record(
  z.enum(['rising', 'breakout', 'viral', 'live_moment', 'vod_ready']),
  alertRuleEntrySchema,
);
export type AlertRulesMap = z.infer<typeof alertRulesMapSchema>;

export const alertRulesSchema = z.object({
  types: alertRulesMapSchema,
  discordDailyDigest: z.boolean().default(false),
  timezone: ianaTimezoneSchema.default('UTC'),
});
export type AlertRulesConfig = z.infer<typeof alertRulesSchema>;

export const testNotificationSchema = z.object({
  channel: z.enum(['discord', 'in_app', 'webpush']),
});
export type TestNotificationInput = z.infer<typeof testNotificationSchema>;

export const memberAvailabilityWindowSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    enabled: z.boolean(),
  })
  .refine((w) => w.endHour > w.startHour, {
    message: 'endHour must be greater than startHour',
  });

export const memberAvailabilitySchema = z.object({
  timezone: ianaTimezoneSchema.default('UTC'),
  schedule: z.array(memberAvailabilityWindowSchema).max(14),
});
export type MemberAvailability = z.infer<typeof memberAvailabilitySchema>;

export const paceLabelSchema = z.enum([
  'Normal pace',
  'Rising',
  'Breakout',
  'Viral',
  'Unscored — collecting baseline',
]);
export type PaceLabel = z.infer<typeof paceLabelSchema>;
