import { describe, expect, it } from 'vitest';
import { nextMidnightPacificMs, TokenBucketQuotaGovernor } from './quota.js';

describe('TokenBucketQuotaGovernor', () => {
  it('enforces daily budget and token capacity', () => {
    let now = Date.UTC(2026, 10, 26, 12, 0, 0);
    const gov = new TokenBucketQuotaGovernor(
      {
        youtube: {
          dailyBudget: 5,
          windowCapacity: 3,
          refillPerSecond: 1,
          circuitBreakerCooldownMs: 60_000,
        },
        twitch: {
          dailyBudget: 100,
          windowCapacity: 10,
          refillPerSecond: 5,
          circuitBreakerCooldownMs: 60_000,
        },
        kick: {
          dailyBudget: 100,
          windowCapacity: 10,
          refillPerSecond: 5,
          circuitBreakerCooldownMs: 60_000,
        },
      },
      () => now,
    );

    expect(gov.consume('youtube', 2)).toBe(true);
    expect(gov.consume('youtube', 2)).toBe(false); // only 1 token left in window
    now += 2000;
    expect(gov.consume('youtube', 2)).toBe(true); // refilled 2 tokens, dailyUsed = 4
    expect(gov.consume('youtube', 2)).toBe(false); // exceeds dailyBudget 5
    expect(gov.isDegraded('youtube')).toBe(false);
    expect(gov.consume('youtube', 1)).toBe(true); // dailyUsed = 5
    expect(gov.isDegraded('youtube')).toBe(true);
  });

  it('opens circuit breaker on 429 and resets after cooldown', () => {
    let now = Date.UTC(2026, 10, 26, 12, 0, 0);
    const gov = new TokenBucketQuotaGovernor(undefined, () => now);

    gov.recordRateLimit('twitch', 30);
    expect(gov.isDegraded('twitch')).toBe(true);
    expect(gov.canConsume('twitch', 1)).toBe(false);

    now += 31_000;
    expect(gov.isDegraded('twitch')).toBe(false);
    expect(gov.canConsume('twitch', 1)).toBe(true);
  });

  it('computes YouTube midnight Pacific reset in the future', () => {
    const now = Date.UTC(2026, 10, 26, 20, 0, 0); // 12:00 PST
    const reset = nextMidnightPacificMs(now);
    expect(reset).toBeGreaterThan(now);
    expect(reset - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});
