export interface ShortClassificationInput {
  readonly durationSec?: number | null;
  readonly url?: string | null;
  readonly title?: string | null;
}

export interface ShortClassificationResult {
  readonly isShort: boolean;
  readonly reason: 'url_shorts_path' | 'duration_le_180_and_hashtag' | 'duration_le_60' | 'not_short' | 'unknown_duration';
}

/**
 * Known classification limits:
 * 1. YouTube increased Shorts max duration from 60s to 180s (3 min) in Oct 2024;
 *    without an explicit `/shorts/` URL, videos 61-180s are only classified as Shorts
 *    when `#shorts` appears in the title to avoid misclassifying short standard videos.
 * 2. WebSub Atom feeds do not include `durationSec`; URL `/shorts/` is checked first.
 * 3. Live streams or items with missing `durationSec` and no `/shorts/` URL return `isShort: false`.
 */
export const SHORTS_CLASSIFICATION_LIMITS = {
  strictMaxDurationSec: 60,
  extendedMaxDurationSec: 180,
} as const;

const SHORTS_URL_RE = /^https:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/[A-Za-z0-9_-]{6,}/i;
const SHORTS_TAG_RE = /(^|\s)#shorts?\b/i;

export function classifyShort(input: ShortClassificationInput): ShortClassificationResult {
  if (input.url && SHORTS_URL_RE.test(input.url.trim())) {
    return { isShort: true, reason: 'url_shorts_path' };
  }

  const duration = input.durationSec;
  if (duration === undefined || duration === null || !Number.isFinite(duration) || duration <= 0) {
    return { isShort: false, reason: 'unknown_duration' };
  }

  if (duration <= SHORTS_CLASSIFICATION_LIMITS.strictMaxDurationSec) {
    return { isShort: true, reason: 'duration_le_60' };
  }

  if (
    duration <= SHORTS_CLASSIFICATION_LIMITS.extendedMaxDurationSec &&
    input.title &&
    SHORTS_TAG_RE.test(input.title)
  ) {
    return { isShort: true, reason: 'duration_le_180_and_hashtag' };
  }

  return { isShort: false, reason: 'not_short' };
}
