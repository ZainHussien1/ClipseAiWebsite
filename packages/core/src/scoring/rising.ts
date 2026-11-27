import type { RisingTier } from '../api-schemas.js';
import type { PaceLabel } from '../v4-schemas.js';

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
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function medianAbsoluteDeviation(values: readonly number[], center: number): number {
  if (values.length === 0) return 0;
  return median(values.map((v) => Math.abs(v - center)));
}

function resolveTierWithHysteresis(
  score: number,
  previousTier: RisingTier,
  config: Pick<
    RisingConfig,
    'risingThreshold' | 'breakoutThreshold' | 'viralThreshold' | 'hysteresisMargin'
  >,
): RisingTier {
  const m = config.hysteresisMargin;
  const viralMin = previousTier === 'viral' ? config.viralThreshold - m : config.viralThreshold;
  const breakoutMin =
    previousTier === 'breakout' || previousTier === 'viral'
      ? config.breakoutThreshold - m
      : config.breakoutThreshold;
  const risingMin = previousTier !== 'none' ? config.risingThreshold - m : config.risingThreshold;

  if (score >= viralMin) return 'viral';
  if (score >= breakoutMin) return 'breakout';
  if (score >= risingMin) return 'rising';
  return 'none';
}

function formatAgeLabel(ageHours: number): string {
  if (ageHours < 1) return `${Math.max(1, Math.round(ageHours * 60))}m`;
  return `${Math.round(ageHours * 10) / 10}h`;
}

function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

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
      ? (Math.max(0, input.likes ?? 0) + Math.max(0, input.comments ?? 0)) / input.views
      : null;

  const usedColdStart = input.creatorBaseline.length < config.minBaselineSamples;
  const vphSamples = input.creatorBaseline.map((s) => Math.max(0, s.viewsPerHour));
  const engSamples = input.creatorBaseline
    .map((s) => s.engagementRate)
    .filter((v): v is number => v !== null && v !== undefined)
    .map((v) => Math.max(0, v));

  const baselineVph = usedColdStart ? config.coldStartVph : median(vphSamples);
  const baselineEng =
    usedColdStart || engSamples.length === 0 ? config.coldStartEngagement : median(engSamples);
  const vphMad = usedColdStart ? 0 : medianAbsoluteDeviation(vphSamples, baselineVph);

  const velocityRatio = currentVph / Math.max(baselineVph, config.minDenominatorVph);
  const engagementRatio =
    currentEng !== null ? currentEng / Math.max(baselineEng, config.minDenominatorEngagement) : null;
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
      : (config.weights.velocity * velocityRatio + config.weights.acceleration * acceleration) /
        (nonEngWeightSum > 0 ? nonEngWeightSum : 1);

  const tier = resolveTierWithHysteresis(score, input.previousTier ?? 'none', config);
  const ageLabel = formatAgeLabel(safeAgeHours);
  const engText =
    engagementRatio !== null ? `${engagementRatio.toFixed(1)}x engagement` : 'engagement n/a';
  const baselineLabel = usedColdStart ? 'cross-creator baseline' : "this creator's usual";

  return {
    tier,
    score: Math.round(score * 100) / 100,
    velocityRatio: Math.round(velocityRatio * 100) / 100,
    acceleration: Math.round(acceleration * 100) / 100,
    engagementRatio: engagementRatio !== null ? Math.round(engagementRatio * 100) / 100 : null,
    madZScore: Math.round(madZScore * 100) / 100,
    usedColdStart,
    reason: `${velocityRatio.toFixed(1)}x ${baselineLabel} at ${ageLabel} (${engText})`,
  };
}

// ============================================================================
// Rising v2: Snapshot-delta velocity, per-kind >7d baseline (n>=5), backfill
// ============================================================================

export type RisingItemKind = 'video' | 'short' | 'live' | 'vod' | 'clip';

export interface RisingSnapshot {
  readonly capturedAt: string;
  readonly views: number;
  readonly likes?: number | null;
  readonly comments?: number | null;
  readonly isBackfill?: boolean;
}

export interface RisingMatureItem {
  readonly kind: RisingItemKind;
  readonly publishedAt: string;
  readonly views: number;
  readonly likes?: number | null;
}

export interface RisingV2Input {
  readonly kind: RisingItemKind;
  readonly publishedAt: string;
  readonly evaluatedAt: string;
  readonly isBackfill: boolean;
  readonly snapshots: readonly RisingSnapshot[];
  readonly creatorItems: readonly RisingMatureItem[];
  readonly previousTier?: RisingTier;
  readonly lastAlertAt?: string | null;
}

export interface RisingV2Config {
  readonly minBaselineItems: number;
  readonly baselineMinAgeMs: number;
  readonly maxEligibleAgeHours: number;
  readonly minSnapshotGapMs: number;
  readonly minDenominatorVph: number;
  readonly minDenominatorViews: number;
  readonly minDenominatorEngagement: number;
  readonly risingThreshold: number;
  readonly breakoutThreshold: number;
  readonly viralThreshold: number;
  readonly hysteresisMargin: number;
  readonly cooldownMs: number;
}

export const DEFAULT_RISING_V2_CONFIG: RisingV2Config = {
  minBaselineItems: 5,
  baselineMinAgeMs: 7 * 86_400_000,
  maxEligibleAgeHours: 72,
  minSnapshotGapMs: 10 * 60_000,
  minDenominatorVph: 10,
  minDenominatorViews: 100,
  minDenominatorEngagement: 0.005,
  risingThreshold: 1.8,
  breakoutThreshold: 3.0,
  viralThreshold: 5.0,
  hysteresisMargin: 0.25,
  cooldownMs: 2 * 3_600_000,
};

export type RisingV2Status =
  | 'normal'
  | 'rising'
  | 'breakout'
  | 'viral'
  | 'collecting_baseline'
  | 'insufficient_snapshots';

export interface RisingV2Evaluation {
  readonly status: RisingV2Status;
  readonly tier: RisingTier;
  readonly paceLabel: PaceLabel;
  readonly score: number;
  readonly velocityRatio: number;
  readonly deltaViewsPerHour: number;
  readonly deltaLikesPerHour: number | null;
  readonly engagementRatio: number | null;
  readonly baselineN: number;
  readonly baselineRequired: number;
  readonly snapshotCount: number;
  readonly inCooldown: boolean;
  readonly reason: string;
}

const PACE_LABELS: Record<RisingTier, PaceLabel> = {
  none: 'Normal pace',
  rising: 'Rising',
  breakout: 'Breakout',
  viral: 'Viral',
};

function findSnapshotPair(
  snapshots: readonly RisingSnapshot[],
  minGapMs: number,
  isBackfill: boolean,
): { earlier: RisingSnapshot; latest: RisingSnapshot; deltaHours: number; liveCount: number } | null {
  const valid = [...snapshots]
    .filter((s) => Number.isFinite(Date.parse(s.capturedAt)))
    .filter((s) => !isBackfill || !s.isBackfill)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));

  if (valid.length < 2) return null;
  const latest = valid[valid.length - 1];
  if (!latest) return null;
  const latestMs = Date.parse(latest.capturedAt);

  for (let i = valid.length - 2; i >= 0; i -= 1) {
    const candidate = valid[i];
    if (!candidate) continue;
    const gapMs = latestMs - Date.parse(candidate.capturedAt);
    if (gapMs >= minGapMs) {
      return {
        earlier: candidate,
        latest,
        deltaHours: gapMs / 3_600_000,
        liveCount: valid.length,
      };
    }
  }
  return null;
}

function expectedCurveFraction(ageHours: number): number {
  return Math.min(1, Math.pow(Math.max(0.5, ageHours) / 168, 0.35));
}

function buildBaselineResult(
  status: RisingV2Status,
  paceLabel: PaceLabel,
  baselineN: number,
  required: number,
  snapshotCount: number,
  reason: string,
  inCooldown = false,
): RisingV2Evaluation {
  return {
    status,
    tier: 'none',
    paceLabel,
    score: 0,
    velocityRatio: 0,
    deltaViewsPerHour: 0,
    deltaLikesPerHour: null,
    engagementRatio: null,
    baselineN,
    baselineRequired: required,
    snapshotCount,
    inCooldown,
    reason,
  };
}

/**
 * Rising v2 scorer: requires >=5 same-kind mature (>7d) baseline items,
 * computes velocity strictly as deltaViews / deltaHours across >=2 snapshots >=10m apart,
 * protects backfill items, and omits engagement when likes are unknown.
 */
export function evaluateRisingV2(
  input: RisingV2Input,
  config: RisingV2Config = DEFAULT_RISING_V2_CONFIG,
): RisingV2Evaluation {
  const evalMs = Date.parse(input.evaluatedAt);
  const pubMs = Date.parse(input.publishedAt);
  const matureSameKind = input.creatorItems.filter(
    (it) => it.kind === input.kind && evalMs - Date.parse(it.publishedAt) > config.baselineMinAgeMs,
  );
  const baselineN = matureSameKind.length;
  const req = config.minBaselineItems;

  if (baselineN < req) {
    return buildBaselineResult(
      'collecting_baseline',
      'Unscored — collecting baseline',
      baselineN,
      req,
      input.snapshots.length,
      `Unscored — collecting baseline (${baselineN}/${req})`,
    );
  }

  const ageHours = Number.isFinite(evalMs) && Number.isFinite(pubMs) ? (evalMs - pubMs) / 3_600_000 : 0;
  if (ageHours >= config.maxEligibleAgeHours) {
    return buildBaselineResult(
      'normal',
      'Normal pace',
      baselineN,
      req,
      input.snapshots.length,
      `Outside ${config.maxEligibleAgeHours}h rising window (baseline from ${baselineN} items)`,
    );
  }

  const pair = findSnapshotPair(input.snapshots, config.minSnapshotGapMs, input.isBackfill);
  if (!pair) {
    const note = input.isBackfill
      ? 'Backfill item awaiting >=2 live snapshots >=10m apart'
      : 'Collecting snapshots (need >=2 snapshots >=10m apart)';
    return buildBaselineResult('insufficient_snapshots', 'Normal pace', baselineN, req, input.snapshots.length, note);
  }

  if (input.lastAlertAt && Number.isFinite(evalMs)) {
    const lastMs = Date.parse(input.lastAlertAt);
    if (Number.isFinite(lastMs) && evalMs - lastMs < config.cooldownMs) {
      const held = input.previousTier ?? 'none';
      return {
        ...buildBaselineResult('normal', PACE_LABELS[held], baselineN, req, pair.liveCount, 'Item alert cooldown active', true),
        status: held === 'none' ? 'normal' : held,
        tier: held,
      };
    }
  }

  const deltaViews = Math.max(0, pair.latest.views - pair.earlier.views);
  const deltaVph = deltaViews / pair.deltaHours;
  const medianViews = median(matureSameKind.map((m) => Math.max(0, m.views)));
  const safeAge = Math.max(0.5, ageHours);
  const expectedVph = Math.max(
    config.minDenominatorVph,
    (Math.max(medianViews, config.minDenominatorViews) * expectedCurveFraction(safeAge)) / safeAge,
  );
  const velocityRatio = deltaVph / expectedVph;

  const hasLikes =
    pair.latest.likes !== null &&
    pair.latest.likes !== undefined &&
    pair.earlier.likes !== null &&
    pair.earlier.likes !== undefined;
  const deltaLikesPerHour = hasLikes
    ? Math.max(0, (pair.latest.likes ?? 0) - (pair.earlier.likes ?? 0)) / pair.deltaHours
    : null;

  const matureEngRates = matureSameKind
    .filter((m) => m.likes !== null && m.likes !== undefined && m.views > 0)
    .map((m) => Math.max(0, m.likes ?? 0) / m.views);
  let engagementRatio: number | null = null;
  if (hasLikes && deltaViews > 0 && matureEngRates.length > 0) {
    const curEng = Math.max(0, (pair.latest.likes ?? 0) - (pair.earlier.likes ?? 0)) / deltaViews;
    engagementRatio = curEng / Math.max(median(matureEngRates), config.minDenominatorEngagement);
  }

  const score =
    engagementRatio !== null ? 0.8 * velocityRatio + 0.2 * engagementRatio : velocityRatio;
  const tier = resolveTierWithHysteresis(score, input.previousTier ?? 'none', config);
  const ageLabel = formatAgeLabel(safeAge);
  const viewsLabel = formatCompactCount(pair.latest.views);

  return {
    status: tier === 'none' ? 'normal' : tier,
    tier,
    paceLabel: PACE_LABELS[tier],
    score: Math.round(score * 100) / 100,
    velocityRatio: Math.round(velocityRatio * 100) / 100,
    deltaViewsPerHour: Math.round(deltaVph * 100) / 100,
    deltaLikesPerHour: deltaLikesPerHour !== null ? Math.round(deltaLikesPerHour * 100) / 100 : null,
    engagementRatio: engagementRatio !== null ? Math.round(engagementRatio * 100) / 100 : null,
    baselineN,
    baselineRequired: req,
    snapshotCount: pair.liveCount,
    inCooldown: false,
    reason: `${viewsLabel} views in ${ageLabel} · ${velocityRatio.toFixed(1)}x creator's usual at ${ageLabel} (baseline from ${baselineN} items)`,
  };
}
