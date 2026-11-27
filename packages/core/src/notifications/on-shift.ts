import { memberAvailabilitySchema, type MemberAvailability } from '../v4-schemas.js';

export interface ShiftMember {
  readonly userId: string;
  readonly availabilityJson: string | null | undefined;
  readonly timezone?: string | null;
}

export interface OnShiftRoutingResult<T extends ShiftMember> {
  readonly primaryRecipients: readonly T[];
  readonly offShiftRecipients: readonly T[];
  readonly usedFallback: boolean;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function getLocalDayAndHour(nowMs: number, timezone: string): { day: number; hour: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date(nowMs));
    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value.toLowerCase() ?? '';
    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '';
    const parsedHour = Number(hourStr);
    const day = WEEKDAY_INDEX[weekdayStr];
    if (day !== undefined && Number.isInteger(parsedHour)) {
      return { day, hour: parsedHour === 24 ? 0 : parsedHour };
    }
  } catch {
    // Fall back to UTC if timezone is invalid
  }
  const d = new Date(nowMs);
  return { day: d.getUTCDay(), hour: d.getUTCHours() };
}

function parseAvailability(raw: string | null | undefined): MemberAvailability | null {
  if (!raw || raw.trim() === '' || raw.trim() === '{}') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const validated = memberAvailabilitySchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

/**
 * Checks whether a member is currently on shift according to their availability
 * schedule and IANA timezone. Unconfigured schedules default to available.
 */
export function isMemberOnShift(
  availabilityJson: string | null | undefined,
  memberTz: string | null | undefined,
  nowIso: string,
): boolean {
  const availability = parseAvailability(availabilityJson);
  if (!availability) return true;

  const hasAnyEnabledRule = availability.schedule.some((w) => w.enabled);
  if (!hasAnyEnabledRule && availability.schedule.length === 0) return true;

  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return true;

  const tz = memberTz && memberTz.trim() ? memberTz : availability.timezone;
  const { day, hour } = getLocalDayAndHour(nowMs, tz);

  return availability.schedule.some(
    (w) => w.enabled && w.day === day && hour >= w.startHour && hour < w.endHour,
  );
}

/**
 * Routes P1 alerts to on-shift members first; falls back to all members
 * if nobody is currently on shift.
 */
export function filterOnShiftRecipients<T extends ShiftMember>(
  members: readonly T[],
  nowIso: string,
): OnShiftRoutingResult<T> {
  if (members.length === 0) {
    return { primaryRecipients: [], offShiftRecipients: [], usedFallback: false };
  }

  const onShift: T[] = [];
  const offShift: T[] = [];

  for (const member of members) {
    if (isMemberOnShift(member.availabilityJson, member.timezone, nowIso)) {
      onShift.push(member);
    } else {
      offShift.push(member);
    }
  }

  if (onShift.length === 0) {
    return {
      primaryRecipients: members,
      offShiftRecipients: [],
      usedFallback: true,
    };
  }

  return {
    primaryRecipients: onShift,
    offShiftRecipients: offShift,
    usedFallback: false,
  };
}
