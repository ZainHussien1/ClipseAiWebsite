import type { Platform } from '../types.js';

export interface ProviderQuotaConfig {
  readonly dailyBudget: number;
  readonly windowCapacity: number;
  readonly refillPerSecond: number;
  readonly circuitBreakerCooldownMs: number;
}

export const DEFAULT_PROVIDER_QUOTAS: Readonly<Record<Platform, ProviderQuotaConfig>> = {
  youtube: {
    dailyBudget: 10_000,
    windowCapacity: 200,
    refillPerSecond: 5,
    circuitBreakerCooldownMs: 15 * 60_000,
  },
  twitch: {
    dailyBudget: 250_000,
    windowCapacity: 800,
    refillPerSecond: 13,
    circuitBreakerCooldownMs: 60_000,
  },
  kick: {
    dailyBudget: 100_000,
    windowCapacity: 120,
    refillPerSecond: 2,
    circuitBreakerCooldownMs: 60_000,
  },
};

export interface QuotaStateSnapshot {
  readonly platform: Platform;
  readonly dailyUsed: number;
  readonly dailyBudget: number;
  readonly tokens: number;
  readonly circuitOpenUntilMs: number | null;
  readonly resetAtMs: number;
}

interface InternalBucket {
  dailyUsed: number;
  tokens: number;
  lastRefillMs: number;
  resetAtMs: number;
  circuitOpenUntilMs: number | null;
}

/**
 * Computes the next midnight Pacific Time (America/Los_Angeles) in epoch ms.
 * Handles PST (-08:00) and PDT (-07:00) via Intl.DateTimeFormat without external deps.
 */
export function nextMidnightPacificMs(nowMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(nowMs));

  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  const hour = get('hour') % 24;
  const minute = get('minute');
  const second = get('second');
  const elapsedTodayMs = ((hour * 60 + minute) * 60 + second) * 1000;
  const remainingApproxMs = 24 * 60 * 60 * 1000 - elapsedTodayMs;
  const candidate = nowMs + remainingApproxMs;
  // Snap to exact minute boundary (within 1s)
  return Math.ceil(candidate / 60_000) * 60_000;
}

export function nextMidnightUtcMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

function nextResetMs(platform: Platform, nowMs: number): number {
  return platform === 'youtube' ? nextMidnightPacificMs(nowMs) : nextMidnightUtcMs(nowMs);
}

export class TokenBucketQuotaGovernor {
  private readonly configs: Readonly<Record<Platform, ProviderQuotaConfig>>;
  private readonly buckets: Map<Platform, InternalBucket> = new Map();
  private readonly now: () => number;

  constructor(
    configs: Readonly<Record<Platform, ProviderQuotaConfig>> = DEFAULT_PROVIDER_QUOTAS,
    now: () => number = () => Date.now(),
  ) {
    this.configs = configs;
    this.now = now;
  }

  private getOrInit(platform: Platform, nowMs: number): InternalBucket {
    const cfg = this.configs[platform];
    let bucket = this.buckets.get(platform);
    if (!bucket) {
      bucket = {
        dailyUsed: 0,
        tokens: cfg.windowCapacity,
        lastRefillMs: nowMs,
        resetAtMs: nextResetMs(platform, nowMs),
        circuitOpenUntilMs: null,
      };
      this.buckets.set(platform, bucket);
      return bucket;
    }

    if (nowMs >= bucket.resetAtMs) {
      bucket.dailyUsed = 0;
      bucket.tokens = cfg.windowCapacity;
      bucket.lastRefillMs = nowMs;
      bucket.resetAtMs = nextResetMs(platform, nowMs);
      bucket.circuitOpenUntilMs = null;
    } else {
      const elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
      if (elapsedSec > 0) {
        bucket.tokens = Math.min(
          cfg.windowCapacity,
          bucket.tokens + elapsedSec * cfg.refillPerSecond,
        );
        bucket.lastRefillMs = nowMs;
      }
      if (bucket.circuitOpenUntilMs !== null && nowMs >= bucket.circuitOpenUntilMs) {
        bucket.circuitOpenUntilMs = null;
      }
    }

    return bucket;
  }

  canConsume(platform: Platform, cost = 1): boolean {
    if (cost <= 0) return true;
    const nowMs = this.now();
    const cfg = this.configs[platform];
    const bucket = this.getOrInit(platform, nowMs);
    if (bucket.circuitOpenUntilMs !== null) return false;
    if (bucket.dailyUsed + cost > cfg.dailyBudget) return false;
    return bucket.tokens >= cost;
  }

  consume(platform: Platform, cost = 1): boolean {
    if (cost <= 0) return true;
    const nowMs = this.now();
    const cfg = this.configs[platform];
    const bucket = this.getOrInit(platform, nowMs);
    if (bucket.circuitOpenUntilMs !== null) return false;
    if (bucket.dailyUsed + cost > cfg.dailyBudget) return false;
    if (bucket.tokens < cost) return false;
    bucket.dailyUsed += cost;
    bucket.tokens -= cost;
    return true;
  }

  recordRateLimit(platform: Platform, retryAfterSeconds?: number): void {
    const nowMs = this.now();
    const cfg = this.configs[platform];
    const bucket = this.getOrInit(platform, nowMs);
    const cooldownMs =
      retryAfterSeconds && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : cfg.circuitBreakerCooldownMs;
    bucket.circuitOpenUntilMs = nowMs + cooldownMs;
    bucket.tokens = 0;
  }

  isDegraded(platform: Platform): boolean {
    const nowMs = this.now();
    const cfg = this.configs[platform];
    const bucket = this.getOrInit(platform, nowMs);
    return bucket.circuitOpenUntilMs !== null || bucket.dailyUsed >= cfg.dailyBudget;
  }

  snapshot(platform: Platform): QuotaStateSnapshot {
    const nowMs = this.now();
    const cfg = this.configs[platform];
    const bucket = this.getOrInit(platform, nowMs);
    return {
      platform,
      dailyUsed: bucket.dailyUsed,
      dailyBudget: cfg.dailyBudget,
      tokens: Math.floor(bucket.tokens),
      circuitOpenUntilMs: bucket.circuitOpenUntilMs,
      resetAtMs: bucket.resetAtMs,
    };
  }
}
