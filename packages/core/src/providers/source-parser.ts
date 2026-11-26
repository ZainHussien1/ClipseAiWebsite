import { z } from 'zod';
import type { Platform } from '../types.js';

export interface ParsedSource {
  readonly platform: Platform;
  readonly externalId: string;
  readonly idKind: 'channel_id' | 'handle' | 'username';
}

export type SourceParseErrorCode =
  | 'EMPTY_INPUT'
  | 'INVALID_URL'
  | 'UNSUPPORTED_HOST'
  | 'UNSUPPORTED_PATH'
  | 'INVALID_IDENTIFIER';

export interface SourceParseError {
  readonly ok: false;
  readonly code: SourceParseErrorCode;
  readonly message: string;
}

export interface SourceParseSuccess {
  readonly ok: true;
  readonly value: ParsedSource;
}

export type SourceParseResult = SourceParseSuccess | SourceParseError;

export const sourceInputSchema = z.string().trim().min(1).max(512);

const YOUTUBE_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const YOUTUBE_HANDLE_RE = /^@[A-Za-z0-9._-]{3,30}$/;
const TWITCH_LOGIN_RE = /^[a-z0-9_]{3,25}$/;
const KICK_SLUG_RE = /^[a-z0-9_-]{2,32}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);

const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv']);
const KICK_HOSTS = new Set(['kick.com', 'www.kick.com']);

const RESERVED_TWITCH_PATHS = new Set([
  'directory',
  'downloads',
  'jobs',
  'p',
  'settings',
  'subscriptions',
  'turbo',
  'videos',
  'clip',
]);

const RESERVED_KICK_PATHS = new Set([
  'browse',
  'categories',
  'following',
  'search',
  'settings',
  'subscriptions',
  'transactions',
]);

function fail(code: SourceParseErrorCode, message: string): SourceParseError {
  return { ok: false, code, message };
}

function ok(
  platform: Platform,
  externalId: string,
  idKind: ParsedSource['idKind'],
): SourceParseSuccess {
  return { ok: true, value: { platform, externalId, idKind } };
}

function parseYouTubePath(segments: readonly string[]): SourceParseResult {
  const [first, second] = segments;
  if (!first) {
    return fail('UNSUPPORTED_PATH', 'Missing YouTube channel path');
  }
  if (first === 'channel' && second && YOUTUBE_CHANNEL_ID_RE.test(second)) {
    return ok('youtube', second, 'channel_id');
  }
  if (first.startsWith('@') && YOUTUBE_HANDLE_RE.test(first)) {
    return ok('youtube', first.toLowerCase(), 'handle');
  }
  if ((first === 'c' || first === 'user') && second && /^[A-Za-z0-9._-]{2,64}$/.test(second)) {
    return ok('youtube', second.toLowerCase(), 'username');
  }
  return fail('UNSUPPORTED_PATH', 'Unsupported YouTube URL path; use /channel/UC... or /@handle');
}

function parseTwitchPath(segments: readonly string[]): SourceParseResult {
  const [first] = segments;
  if (!first) {
    return fail('UNSUPPORTED_PATH', 'Missing Twitch channel slug');
  }
  const normalized = first.toLowerCase();
  if (RESERVED_TWITCH_PATHS.has(normalized) || !TWITCH_LOGIN_RE.test(normalized)) {
    return fail('INVALID_IDENTIFIER', 'Invalid Twitch channel login');
  }
  return ok('twitch', normalized, 'username');
}

function parseKickPath(segments: readonly string[]): SourceParseResult {
  const [first] = segments;
  if (!first) {
    return fail('UNSUPPORTED_PATH', 'Missing Kick channel slug');
  }
  const normalized = first.toLowerCase();
  if (RESERVED_KICK_PATHS.has(normalized) || !KICK_SLUG_RE.test(normalized)) {
    return fail('INVALID_IDENTIFIER', 'Invalid Kick channel slug');
  }
  return ok('kick', normalized, 'username');
}

function parseUrlSource(raw: string): SourceParseResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return fail('INVALID_URL', 'Malformed URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    return fail('INVALID_URL', 'Only clean https:// provider URLs are allowed');
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (YOUTUBE_HOSTS.has(host)) {
    return parseYouTubePath(segments);
  }
  if (TWITCH_HOSTS.has(host)) {
    return parseTwitchPath(segments);
  }
  if (KICK_HOSTS.has(host)) {
    return parseKickPath(segments);
  }
  return fail('UNSUPPORTED_HOST', `Unsupported host: ${host}`);
}

function parsePrefixedOrBare(trimmed: string): SourceParseResult {
  const prefixed = /^(youtube|twitch|kick):(.+)$/i.exec(trimmed);
  if (prefixed) {
    const platform = prefixed[1]?.toLowerCase() as Platform;
    const id = (prefixed[2] ?? '').trim();
    if (platform === 'youtube') {
      if (YOUTUBE_CHANNEL_ID_RE.test(id)) return ok('youtube', id, 'channel_id');
      if (YOUTUBE_HANDLE_RE.test(id)) return ok('youtube', id.toLowerCase(), 'handle');
      return fail('INVALID_IDENTIFIER', 'Invalid YouTube channel ID or @handle');
    }
    if (platform === 'twitch') {
      const lower = id.toLowerCase();
      return TWITCH_LOGIN_RE.test(lower)
        ? ok('twitch', lower, 'username')
        : fail('INVALID_IDENTIFIER', 'Invalid Twitch login');
    }
    const lower = id.toLowerCase();
    return KICK_SLUG_RE.test(lower)
      ? ok('kick', lower, 'username')
      : fail('INVALID_IDENTIFIER', 'Invalid Kick slug');
  }

  if (YOUTUBE_CHANNEL_ID_RE.test(trimmed)) {
    return ok('youtube', trimmed, 'channel_id');
  }
  if (YOUTUBE_HANDLE_RE.test(trimmed)) {
    return ok('youtube', trimmed.toLowerCase(), 'handle');
  }
  return fail(
    'INVALID_IDENTIFIER',
    'Provide an https:// provider URL, a YouTube UC.../@handle, or platform:id',
  );
}

export function normalizeHandle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('@')) {
    return `@${trimmed.replace(/^@+/, '').toLowerCase()}`;
  }
  return trimmed;
}

/**
 * Strictly parses a user-supplied creator source into a fixed-platform identifier.
 * Never returns arbitrary fetchable URLs (SSRF-safe).
 */
export function parseSourceInput(raw: string): SourceParseResult {
  const check = sourceInputSchema.safeParse(raw);
  if (!check.success) {
    return fail('EMPTY_INPUT', 'Source input must be 1..512 non-empty characters');
  }
  const trimmed = check.data.startsWith('@')
    ? `@${check.data.replace(/^@+/, '')}`
    : check.data;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return parseUrlSource(trimmed);
  }
  if (/^(youtube\.com|www\.youtube\.com|twitch\.tv|www\.twitch\.tv|kick\.com|www\.kick\.com)\//i.test(trimmed)) {
    return parseUrlSource(`https://${trimmed}`);
  }
  return parsePrefixedOrBare(trimmed);
}
