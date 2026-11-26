import type { RisingTier } from '../api-schemas.js';

export interface RisingBaselineSample {
  readonly viewsPerHour: number;
  readonly engagementRate?: number | null;
}

export interface RisingInput {
  readonly ageHours: number;
  readonly views: number;
  readonly likes?: number | null;
  readonly comments?: number | null;
  readonly recentViewsPerHour?: number;
  readonly earlierViewsPerHour?: number;
  readonly creatorBaseline: readonly RisingBaselineSample[];
  readonly previousTier?: RisingTier;
}

export interface RisingConfig {
  readonly minBaselineSamples: number;
  readonly minDenominatorVph: number;
  readonly minDenominatorEngagement: number;
  readonly coldStartVph: number;
  readonly coldStartEngagement: number;
  readonly risingThreshold: number;
  readonly breakoutThreshold: number;
  readonly viralThreshold: number;
  readonly hysteresisMargin: number;
  readonly weights: {
    readonly velocity: number;
    readonly acceleration: number;
    readonly engagement: number;
  };
}

export const DEFAULT_RISING_CONFIG: RisingConfig = {
  minBaselineSamples: 3,
  minDenominatorVph: 10,
  minDenominatorEngagement: 0.005,
  coldStartVph: 250,
  coldStartEngagement: 0.03,
  risingThreshold: 1.8,
  breakoutThreshold: 3.0,
  viralThreshold: 5.0,
  hysteresisMargin: 0.25,
  weights: {
    velocity: 0.55,
    acceleration: 0.25,
    engagement: 0.2,
  },
};

export interface RisingEvaluation {
  readonly tier: RisingTier;
  readonly score: number;
  readonly velocityRatio: number;
  readonly acceleration: number;
  readonly engagementRatio: number | null;
  readonly madZScore: number;
  readonly usedColdStart: boolean;
  readonly reason: string;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function medianAbsoluteDeviation(values: readonly number[], center: number): number {
  if (values.length === 0) return 0;
  const deviations = values.map((v) => Math.abs(v - center));
  return median(deviations);
}

function resolveTierWithHysteresis(
  score: number,
  previousTier: RisingTier,
  config: RisingConfig,
): RisingTier {
  const m = config.hysteresisMargin;
  const viralMin = previousTier === 'viral' ? config.viralThreshold - m : config.viralThreshold;
  const breakoutMin =
    previousTier === 'breakout' || previousTier === 'viral'
      ? config.breakoutThreshold - m
      : config.breakoutThreshold;
  const risingMin =
    previousTier !== 'none' ? config.risingThreshold - m : config.risingThreshold;

  if (score >= viralMin) return 'viral';
  if (score >= breakoutMin) return 'breakout';
  if (score >= risingMin) return 'rising';
  return 'none';
}

function formatAgeLabel(ageHours: number): string {
  if (ageHours < 1) {
    const mins = Math.max(1, Math.round(ageHours * 60));
    return `${mins}m`;
  }
  return `${Math.round(ageHours * 10) / 10}h`;
}

/**
 * Pure deterministic Rising/Breakout/Viral scorer using median/MAD baseline
 * with cold-start fallback, denominator guards, and hysteresis.
 */
export function evaluateRising(
  input: RisingInput,
  config: RisingConfig = DEFAULT_RISING_CONFIG,
): RisingEvaluation {
  const safeAgeHours = Math.max(input.ageHours, 0.25);
  const currentVph = Math.max(0, input.views) / safeAgeHours;
  const hasEngagement =
    (input.likes !== null && input.likes !== undefined) ||
    (input.comments !== null && input.comments !== undefined);
  const currentEng =
    hasEngagement && input.views > 0
      ? (Math.max(0, input.likes ?? 0) + Math.max(0, input.comments ?? 0)) /
        input.views
      : null;

  const usedColdStart = input.creatorBaseline.length < config.minBaselineSamples;
  const vphSamples = input.creatorBaseline.map((s) => Math.max(0, s.viewsPerHour));
  const engSamples = input.creatorBaseline
    .map((s) => s.engagementRate)
    .filter((v): v is number => v !== null && v !== undefined)
    .map((v) => Math.max(0, v));

  const baselineVph = usedColdStart ? config.coldStartVph : median(vphSamples);
  const baselineEng =
    usedColdStart || engSamples.length === 0
      ? config.coldStartEngagement
      : median(engSamples);
  const vphMad = usedColdStart ? 0 : medianAbsoluteDeviation(vphSamples, baselineVph);

  const denomVph = Math.max(baselineVph, config.minDenominatorVph);
  const denomEng = Math.max(baselineEng, config.minDenominatorEngagement);

  const velocityRatio = currentVph / denomVph;
  const engagementRatio = currentEng !== null ? currentEng / denomEng : null;
  const acceleration =
    input.recentViewsPerHour !== undefined && input.earlierViewsPerHour !== undefined
      ? Math.max(0, input.recentViewsPerHour) /
        Math.max(input.earlierViewsPerHour, config.minDenominatorVph)
      : 1;

  const madScale = Math.max(1.4826 * vphMad, config.minDenominatorVph);
  const madZScore = (currentVph - baselineVph) / madScale;

  const nonEngWeightSum = config.weights.velocity + config.weights.acceleration;
  const score =
    engagementRatio !== null
      ? config.weights.velocity * velocityRatio +
        config.weights.acceleration * acceleration +
        config.weights.engagement * engagementRatio
      : (config.weights.velocity * velocityRatio +
          config.weights.acceleration * acceleration) /
        (nonEngWeightSum > 0 ? nonEngWeightSum : 1);

  const tier = resolveTierWithHysteresis(score, input.previousTier ?? 'none', config);
  const ageLabel = formatAgeLabel(safeAgeHours);
  const velText = `${velocityRatio.toFixed(1)}x`;
  const engText =
    engagementRatio !== null ? `${engagementRatio.toFixed(1)}x engagement` : 'engagement n/a';
  const baselineLabel = usedColdStart ? 'cross-creator baseline' : "this creator's usual";
  const reason = `${velText} ${baselineLabel} at ${ageLabel} (${engText})`;

  return {
    tier,
    score: Math.round(score * 100) / 100,
    velocityRatio: Math.round(velocityRatio * 100) / 100,
    acceleration: Math.round(acceleration * 100) / 100,
    engagementRatio:
      engagementRatio !== null ? Math.round(engagementRatio * 100) / 100 : null,
    madZScore: Math.round(madZScore * 100) / 100,
    usedColdStart,
    reason,
  };
}
