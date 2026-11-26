import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISING_CONFIG,
  evaluateRising,
  median,
  medianAbsoluteDeviation,
  type RisingBaselineSample,
} from './rising.js';

const creatorSamples: readonly RisingBaselineSample[] = [
  { viewsPerHour: 100, engagementRate: 0.04 },
  { viewsPerHour: 120, engagementRate: 0.05 },
  { viewsPerHour: 110, engagementRate: 0.045 },
  { viewsPerHour: 130, engagementRate: 0.055 },
];

describe('median & MAD', () => {
  it('computes odd, even, empty median and MAD', () => {
    expect(median([])).toBe(0);
    expect(median([10, 30, 20])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(medianAbsoluteDeviation([10, 20, 30], 20)).toBe(10);
    expect(medianAbsoluteDeviation([], 0)).toBe(0);
  });
});

describe('evaluateRising', () => {
  it('classifies normal, rising, breakout, and viral items deterministically', () => {
    const normal = evaluateRising({
      ageHours: 2,
      views: 220,
      likes: 10,
      comments: 1,
      creatorBaseline: creatorSamples,
    });
    expect(normal.tier).toBe('none');
    expect(normal.usedColdStart).toBe(false);

    const rising = evaluateRising({
      ageHours: 2,
      views: 700,
      likes: 40,
      comments: 5,
      recentViewsPerHour: 350,
      earlierViewsPerHour: 200,
      creatorBaseline: creatorSamples,
    });
    expect(rising.tier).toBe('rising');
    expect(rising.reason).toContain("this creator's usual");

    const breakout = evaluateRising({
      ageHours: 2,
      views: 1200,
      likes: 80,
      comments: 10,
      recentViewsPerHour: 600,
      earlierViewsPerHour: 200,
      creatorBaseline: creatorSamples,
    });
    expect(breakout.tier).toBe('breakout');

    const viral = evaluateRising({
      ageHours: 2,
      views: 2200,
      likes: 150,
      comments: 20,
      recentViewsPerHour: 1100,
      earlierViewsPerHour: 200,
      creatorBaseline: creatorSamples,
    });
    expect(viral.tier).toBe('viral');
  });

  it('uses cold-start fallback when creator has fewer than minBaselineSamples', () => {
    const res = evaluateRising({
      ageHours: 1,
      views: 1000,
      likes: 60,
      comments: 10,
      creatorBaseline: [{ viewsPerHour: 50, engagementRate: 0.01 }],
    });
    expect(res.usedColdStart).toBe(true);
    expect(res.reason).toContain('cross-creator baseline');
  });

  it('applies hysteresis to prevent flapping near threshold', () => {
    const borderlineInput = {
      ageHours: 2,
      views: 550,
      likes: 25,
      comments: 2,
      creatorBaseline: creatorSamples,
    };

    const fresh = evaluateRising(borderlineInput);
    expect(fresh.score).toBeGreaterThanOrEqual(
      DEFAULT_RISING_CONFIG.risingThreshold - DEFAULT_RISING_CONFIG.hysteresisMargin,
    );
    expect(fresh.score).toBeLessThan(DEFAULT_RISING_CONFIG.risingThreshold);
    expect(fresh.tier).toBe('none');

    const held = evaluateRising({ ...borderlineInput, previousTier: 'rising' });
    expect(held.tier).toBe('rising');
  });

  it('guards zero/tiny denominators without NaN or Infinity', () => {
    const res = evaluateRising({
      ageHours: 0,
      views: 0,
      likes: 0,
      comments: 0,
      creatorBaseline: [
        { viewsPerHour: 0, engagementRate: 0 },
        { viewsPerHour: 0, engagementRate: 0 },
        { viewsPerHour: 0, engagementRate: 0 },
      ],
    });
    expect(Number.isFinite(res.score)).toBe(true);
    expect(Number.isFinite(res.velocityRatio)).toBe(true);
    expect(res.engagementRatio).toBeNull();
    expect(res.tier).toBe('none');
  });

  it('returns null engagementRatio and omits fake 0.0x when likes and comments are unknown', () => {
    const res = evaluateRising({
      ageHours: 2,
      views: 700,
      likes: null,
      comments: null,
      creatorBaseline: creatorSamples,
    });
    expect(res.engagementRatio).toBeNull();
    expect(res.reason).toContain('engagement n/a');
    expect(res.reason).not.toContain('0.0x');
  });
});
