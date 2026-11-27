import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISING_CONFIG,
  evaluateRising,
  evaluateRisingV2,
  median,
  medianAbsoluteDeviation,
  type RisingBaselineSample,
  type RisingMatureItem,
} from './rising.js';

const creatorSamples: readonly RisingBaselineSample[] = [
  { viewsPerHour: 100, engagementRate: 0.04 },
  { viewsPerHour: 120, engagementRate: 0.05 },
  { viewsPerHour: 110, engagementRate: 0.045 },
  { viewsPerHour: 130, engagementRate: 0.055 },
];

function makeMatureHistory(
  views: number,
  count = 6,
  kind: 'video' | 'short' = 'video',
): RisingMatureItem[] {
  return Array.from({ length: count }, (_, idx) => ({
    kind,
    publishedAt: `2026-10-${String(10 + idx).padStart(2, '0')}T10:00:00Z`,
    views,
    likes: Math.round(views * 0.04),
  }));
}

describe('median & MAD', () => {
  it('computes odd, even, empty median and MAD', () => {
    expect(median([])).toBe(0);
    expect(median([10, 30, 20])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(medianAbsoluteDeviation([10, 20, 30], 20)).toBe(10);
    expect(medianAbsoluteDeviation([], 0)).toBe(0);
  });
});

describe('evaluateRising (v1)', () => {
  it('classifies normal, rising, breakout, and viral items deterministically', () => {
    const normal = evaluateRising({
      ageHours: 2,
      views: 220,
      likes: 10,
      comments: 1,
      creatorBaseline: creatorSamples,
    });
    expect(normal.tier).toBe('none');

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
    expect(fresh.tier).toBe('none');
    expect(evaluateRising({ ...borderlineInput, previousTier: 'rising' }).tier).toBe('rising');
  });
});

describe('evaluateRisingV2', () => {
  const now = '2026-11-26T16:00:00Z';
  const pub6h = '2026-11-26T10:00:00Z';

  it('requires >=5 mature (>7d) same-kind items before scoring', () => {
    const fewVideos = makeMatureHistory(100_000, 4, 'video');
    const manyShorts = makeMatureHistory(500_000, 10, 'short');
    const tooYoungVideo: RisingMatureItem = {
      kind: 'video',
      publishedAt: '2026-11-23T10:00:00Z', // only 3d old
      views: 100_000,
    };

    const res = evaluateRisingV2({
      kind: 'video',
      publishedAt: pub6h,
      evaluatedAt: now,
      isBackfill: false,
      snapshots: [
        { capturedAt: '2026-11-26T15:00:00Z', views: 50_000 },
        { capturedAt: '2026-11-26T16:00:00Z', views: 150_000 },
      ],
      creatorItems: [...fewVideos, ...manyShorts, tooYoungVideo],
    });

    expect(res.status).toBe('collecting_baseline');
    expect(res.paceLabel).toBe('Unscored — collecting baseline');
    expect(res.baselineN).toBe(4);
    expect(res.reason).toBe('Unscored — collecting baseline (4/5)');
  });

  it('requires >=2 snapshots >=10m apart and blocks backfill items on initial sync', () => {
    const history = makeMatureHistory(100_000, 8, 'video');

    const singleSnap = evaluateRisingV2({
      kind: 'video',
      publishedAt: pub6h,
      evaluatedAt: now,
      isBackfill: false,
      snapshots: [{ capturedAt: now, views: 500_000 }],
      creatorItems: history,
    });
    expect(singleSnap.status).toBe('insufficient_snapshots');
    expect(singleSnap.tier).toBe('none');

    const tooCloseSnaps = evaluateRisingV2({
      kind: 'video',
      publishedAt: pub6h,
      evaluatedAt: now,
      isBackfill: false,
      snapshots: [
        { capturedAt: '2026-11-26T15:55:00Z', views: 100_000 },
        { capturedAt: '2026-11-26T16:00:00Z', views: 500_000 },
      ],
      creatorItems: history,
    });
    expect(tooCloseSnaps.status).toBe('insufficient_snapshots');

    const backfillWithOneLive = evaluateRisingV2({
      kind: 'video',
      publishedAt: pub6h,
      evaluatedAt: now,
      isBackfill: true,
      snapshots: [
        { capturedAt: '2026-11-26T12:00:00Z', views: 100_000, isBackfill: true },
        { capturedAt: '2026-11-26T16:00:00Z', views: 500_000, isBackfill: false },
      ],
      creatorItems: history,
    });
    expect(backfillWithOneLive.status).toBe('insufficient_snapshots');
    expect(backfillWithOneLive.tier).toBe('none');
  });

  it('big-creator fairness: 20M-view MrBeast video with 20M baseline scores normal, not viral', () => {
    const mrBeastHistory = makeMatureHistory(20_000_000, 14, 'video');

    const normalPace = evaluateRisingV2({
      kind: 'video',
      publishedAt: '2026-11-25T16:00:00Z', // 24h old
      evaluatedAt: now,
      isBackfill: false,
      snapshots: [
        { capturedAt: '2026-11-26T15:00:00Z', views: 19_600_000, likes: 784_000 },
        { capturedAt: '2026-11-26T16:00:00Z', views: 20_000_000, likes: 800_000 },
      ],
      creatorItems: mrBeastHistory,
    });

    expect(normalPace.status).toBe('normal');
    expect(normalPace.tier).toBe('none');
    expect(normalPace.paceLabel).toBe('Normal pace');
    expect(normalPace.reason).toContain('baseline from 14 items');

    // A genuine 3.2x breakout above MrBeast's usual 6h pace (~1.04M/h -> 3.2M/h)
    const breakout = evaluateRisingV2({
      kind: 'video',
      publishedAt: pub6h,
      evaluatedAt: now,
      isBackfill: false,
      snapshots: [
        { capturedAt: '2026-11-26T15:00:00Z', views: 14_000_000, likes: null },
        { capturedAt: '2026-11-26T16:00:00Z', views: 17_200_000, likes: null },
      ],
      creatorItems: mrBeastHistory,
    });

    expect(breakout.tier).toBe('breakout');
    expect(breakout.paceLabel).toBe('Breakout');
    expect(breakout.engagementRatio).toBeNull();
  });

  it('omits engagement when likes are missing and enforces cooldown + hysteresis', () => {
    const history = makeMatureHistory(100_000, 10, 'short');
    const viral = evaluateRisingV2({
      kind: 'short',
      publishedAt: pub6h,
      evaluatedAt: now,
      isBackfill: false,
      snapshots: [
        { capturedAt: '2026-11-26T15:00:00Z', views: 120_000, likes: null },
        { capturedAt: '2026-11-26T16:00:00Z', views: 150_000, likes: null },
      ],
      creatorItems: history,
    });
    expect(viral.tier).toBe('viral');
    expect(viral.engagementRatio).toBeNull();
    expect(viral.deltaLikesPerHour).toBeNull();

    const cooledDown = evaluateRisingV2({
      kind: 'short',
      publishedAt: pub6h,
      evaluatedAt: now,
      isBackfill: false,
      snapshots: [
        { capturedAt: '2026-11-26T15:00:00Z', views: 120_000 },
        { capturedAt: '2026-11-26T16:00:00Z', views: 150_000 },
      ],
      creatorItems: history,
      previousTier: 'viral',
      lastAlertAt: '2026-11-26T15:30:00Z',
    });
    expect(cooledDown.inCooldown).toBe(true);
    expect(cooledDown.tier).toBe('viral');
  });
});
