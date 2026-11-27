export type ShortsClassification = 'short' | 'video' | 'unclassified';

export interface ShortClassificationInput {
  readonly url?: string | null;
  readonly title?: string | null;
  readonly durationSec?: number | null;
  readonly aspectRatio?: number | string | null;
}

export type ShortClassificationReason =
  | 'url_shorts_path'
  | 'duration_gt_180'
  | 'vertical_within_180s'
  | 'horizontal_video'
  | 'hashtag_within_180s'
  | 'ambiguous_duration_le_180'
  | 'unknown_duration';

export interface ShortClassificationResult {
  readonly classification: ShortsClassification;
  readonly isShort: boolean;
  readonly reason: ShortClassificationReason;
}

/**
 * Known classification limits:
 * 1. YouTube Shorts run up to 180s (3 min); never assume <=60s implies a Short,
 *    since horizontal trailers/clips under 60s are standard Videos.
 * 2. Canonical `/shorts/` URLs classify as `'short'` when duration is unknown or <=180s.
 * 3. For `durationSec <= 180` without `/shorts/` URL, vertical/square aspect ratios
 *    (<= 1.05) or `#shorts` title tags settle `'short'`, horizontal aspect ratios
 *    (> 1.05) settle `'video'`, and missing aspect ratio without `#shorts` stays
 *    `'unclassified'` rather than guessing.
 * 4. Items with missing/invalid `durationSec` and no `/shorts/` URL always return
 *    `'unclassified'`.
 */
export const SHORTS_CLASSIFICATION_LIMITS = {
  maxDurationSec: 180,
  verticalOrSquareMaxAspectRatio: 1.05,
} as const;

const SHORTS_URL_RE = /^https:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/[A-Za-z0-9_-]{6,}/i;
const SHORTS_TAG_RE = /(^|\s)#shorts?\b/i;

export function parseAspectRatio(raw: number | string | null | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === 'vertical' || trimmed === 'portrait') return 9 / 16;
  if (trimmed === 'square') return 1;
  if (trimmed === 'horizontal' || trimmed === 'landscape') return 16 / 9;

  const ratioMatch = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (ratioMatch) {
    const w = Number(ratioMatch[1]);
    const h = Number(ratioMatch[2]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return w / h;
    }
    return null;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function classifyShort(input: ShortClassificationInput): ShortClassificationResult {
  const duration = input.durationSec;
  const hasDuration =
    duration !== undefined && duration !== null && Number.isFinite(duration) && duration > 0;

  if (hasDuration && duration > SHORTS_CLASSIFICATION_LIMITS.maxDurationSec) {
    return { classification: 'video', isShort: false, reason: 'duration_gt_180' };
  }

  if (input.url && SHORTS_URL_RE.test(input.url.trim())) {
    return { classification: 'short', isShort: true, reason: 'url_shorts_path' };
  }

  if (!hasDuration) {
    return { classification: 'unclassified', isShort: false, reason: 'unknown_duration' };
  }

  const aspectRatio = parseAspectRatio(input.aspectRatio);
  if (aspectRatio !== null) {
    if (aspectRatio <= SHORTS_CLASSIFICATION_LIMITS.verticalOrSquareMaxAspectRatio) {
      return { classification: 'short', isShort: true, reason: 'vertical_within_180s' };
    }
    return { classification: 'video', isShort: false, reason: 'horizontal_video' };
  }

  if (input.title && SHORTS_TAG_RE.test(input.title)) {
    return { classification: 'short', isShort: true, reason: 'hashtag_within_180s' };
  }

  return { classification: 'unclassified', isShort: false, reason: 'ambiguous_duration_le_180' };
}
