import type { Platform } from './contracts';

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'twitch.tv',
  'www.twitch.tv',
  'clips.twitch.tv',
  'kick.com',
  'www.kick.com',
  'tiktok.com',
  'www.tiktok.com',
  'instagram.com',
  'www.instagram.com',
  'x.com',
  'twitter.com',
]);

export function safeExternalUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeHandle(raw: string): string {
  const clean = raw.trim().replace(/^@+/, '');
  return clean ? `@${clean}` : 'unknown';
}

export function formatAgeSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return 'unknown';
  }
  const s = Math.max(0, Math.floor(seconds));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatHumanDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return 'n/a';
  }
  const total = Math.max(0, Math.floor(seconds));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatDurationSince(isoDate: string): string {
  const start = Date.parse(isoDate);
  if (!Number.isFinite(start)) return 'n/a';
  return formatHumanDuration(Math.max(0, Math.floor((Date.now() - start) / 1000)));
}

export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return formatHumanDuration(sec);
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const PLATFORM_DEFAULT_PROVENANCE: Record<Platform, string> = {
  youtube: 'YouTube RSS',
  twitch: 'Twitch Helix',
  kick: 'Kick API',
};

export function formatProvenance(source: string | null | undefined, platform?: Platform): string {
  const s = source?.trim() ?? '';
  if (!s || s.toLowerCase() === 'd1' || s.startsWith('/api/')) {
    return platform ? PLATFORM_DEFAULT_PROVENANCE[platform] : 'Upstream Feed';
  }
  return s;
}
