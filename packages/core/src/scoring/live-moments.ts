import type { AlertConfidence, AlertType } from '../api-schemas.js';
import type { Platform } from '../types.js';
import { median } from './rising.js';

export interface LiveViewerSample {
  readonly sampledAt: string;
  readonly viewers: number;
}

export interface LiveClipSample {
  readonly id: string;
  readonly createdAt: string;
  readonly creatorName: string;
  readonly vodOffsetSeconds?: number | null;
}

export interface LiveMomentInput {
  readonly platform: Platform;
  readonly isLive: boolean;
  readonly streamStartedAt: string;
  readonly evaluatedAt: string;
  readonly viewerSamples: readonly LiveViewerSample[];
  readonly recentClips?: readonly LiveClipSample[];
  readonly usualClipsPerWindow?: number | null;
  readonly lastAlertAt?: string | null;
}

export interface LiveMomentConfig {
  readonly baselineWindowMs: number;
  readonly recentExcludeMs: number;
  readonly minBaselineSamples: number;
  readonly sustainedSampleCount: number;
  readonly minViewerGain: number;
  readonly weakViewerPctGain: number;
  readonly strongViewerPctGain: number;
  readonly clipWindowMs: number;
  readonly coldStartWeakDistinctCreators: number;
  readonly coldStartStrongDistinctCreators: number;
  readonly weakClipRateRatio: number;
  readonly strongClipRateRatio: number;
  readonly cooldownMs: number;
  readonly escalationDelayMs: number;
}

export const DEFAULT_LIVE_MOMENT_CONFIG: LiveMomentConfig = {
  baselineWindowMs: 30 * 60_000,
  recentExcludeMs: 4 * 60_000,
  minBaselineSamples: 3,
  sustainedSampleCount: 2,
  minViewerGain: 40,
  weakViewerPctGain: 0.2,
  strongViewerPctGain: 0.35,
  clipWindowMs: 3 * 60_000,
  coldStartWeakDistinctCreators: 2,
  coldStartStrongDistinctCreators: 4,
  weakClipRateRatio: 2.0,
  strongClipRateRatio: 3.5,
  cooldownMs: 10 * 60_000,
  escalationDelayMs: 10 * 60_000,
};

export type SignalStrength = 'none' | 'weak' | 'strong';
export type SignalCapability = 'viewer_and_clips' | 'viewer_spike_only';
export type StreamOffsetKind = 'exact' | 'approx';

export interface LiveMomentEvaluation {
  readonly detected: boolean;
  readonly inCooldown: boolean;
  readonly confidence: AlertConfidence | null;
  readonly score: number;
  readonly signalCapability: SignalCapability;
  readonly viewerSignal: SignalStrength;
  readonly clipSignal: SignalStrength;
  readonly baselineViewers: number;
  readonly currentViewers: number;
  readonly viewerGain: number;
  readonly viewerGainPct: number;
  readonly clipCount: number;
  readonly distinctClipCreators: number;
  readonly offsetSeconds: number | null;
  readonly offsetKind: StreamOffsetKind | null;
  readonly evidence: string;
}

function formatOffsetLabel(seconds: number, kind: StreamOffsetKind): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  const formatted = `${mins}m${String(secs).padStart(2, '0')}s`;
  return kind === 'exact' ? `vod_offset ${formatted}` : `approx. ${formatted}`;
}

function evaluateViewerSpike(
  input: LiveMomentInput,
  evalMs: number,
  config: LiveMomentConfig,
): {
  strength: SignalStrength;
  baselineViewers: number;
  currentViewers: number;
  gain: number;
  gainPct: number;
} {
  const sorted = [...input.viewerSamples]
    .map((s) => ({ ts: Date.parse(s.sampledAt), viewers: Math.max(0, s.viewers) }))
    .filter((s) => Number.isFinite(s.ts) && s.ts <= evalMs)
    .sort((a, b) => a.ts - b.ts);

  if (sorted.length === 0) {
    return { strength: 'none', baselineViewers: 0, currentViewers: 0, gain: 0, gainPct: 0 };
  }

  const currentViewers = sorted[sorted.length - 1]?.viewers ?? 0;
  const baselineStart = evalMs - config.baselineWindowMs;
  const baselineEnd = evalMs - config.recentExcludeMs;

  const baselineSamples = sorted
    .filter((s) => s.ts >= baselineStart && s.ts <= baselineEnd)
    .map((s) => s.viewers);

  if (baselineSamples.length < config.minBaselineSamples) {
    return {
      strength: 'none',
      baselineViewers: median(baselineSamples),
      currentViewers,
      gain: 0,
      gainPct: 0,
    };
  }

  const baselineViewers = median(baselineSamples);
  const gain = currentViewers - baselineViewers;
  const gainPct = baselineViewers > 0 ? gain / baselineViewers : 0;

  const recentSamples = sorted.slice(-config.sustainedSampleCount);
  if (recentSamples.length < config.sustainedSampleCount) {
    return { strength: 'none', baselineViewers, currentViewers, gain, gainPct };
  }

  const minSustained = Math.min(...recentSamples.map((s) => s.viewers));
  const sustainedGain = minSustained - baselineViewers;
  const sustainedPct = baselineViewers > 0 ? sustainedGain / baselineViewers : 0;

  let strength: SignalStrength = 'none';
  if (sustainedGain >= config.minViewerGain) {
    if (sustainedPct >= config.strongViewerPctGain) {
      strength = 'strong';
    } else if (sustainedPct >= config.weakViewerPctGain) {
      strength = 'weak';
    }
  }

  return { strength, baselineViewers, currentViewers, gain, gainPct };
}

function evaluateClipVelocity(
  input: LiveMomentInput,
  evalMs: number,
  config: LiveMomentConfig,
): {
  strength: SignalStrength;
  clipCount: number;
  distinctCreators: number;
  offsetSeconds: number | null;
  offsetKind: StreamOffsetKind | null;
} {
  if (input.platform !== 'twitch') {
    return {
      strength: 'none',
      clipCount: 0,
      distinctCreators: 0,
      offsetSeconds: null,
      offsetKind: null,
    };
  }

  const windowStart = evalMs - config.clipWindowMs;
  const inWindow = (input.recentClips ?? [])
    .map((c) => ({ ...c, ts: Date.parse(c.createdAt) }))
    .filter((c) => Number.isFinite(c.ts) && c.ts >= windowStart && c.ts <= evalMs)
    .sort((a, b) => a.ts - b.ts);

  const distinctCreators = new Set(
    inWindow.map((c) => c.creatorName.trim().toLowerCase()).filter(Boolean),
  ).size;

  const usual = input.usualClipsPerWindow;
  let strength: SignalStrength = 'none';

  if (usual !== undefined && usual !== null && usual > 0) {
    const ratio = distinctCreators / usual;
    if (ratio >= config.strongClipRateRatio && distinctCreators >= 2) {
      strength = 'strong';
    } else if (ratio >= config.weakClipRateRatio && distinctCreators >= 2) {
      strength = 'weak';
    }
  } else {
    if (distinctCreators >= config.coldStartStrongDistinctCreators) {
      strength = 'strong';
    } else if (distinctCreators >= config.coldStartWeakDistinctCreators) {
      strength = 'weak';
    }
  }

  const latest = inWindow[inWindow.length - 1];
  let offsetSeconds: number | null = null;
  let offsetKind: StreamOffsetKind | null = null;

  if (latest) {
    const exactClip = [...inWindow].reverse().find((c) => typeof c.vodOffsetSeconds === 'number');
    if (exactClip && typeof exactClip.vodOffsetSeconds === 'number') {
      offsetSeconds = Math.max(0, Math.round(exactClip.vodOffsetSeconds));
      offsetKind = 'exact';
    } else {
      const startMs = Date.parse(input.streamStartedAt);
      if (Number.isFinite(startMs)) {
        offsetSeconds = Math.max(0, Math.round((latest.ts - startMs) / 1000));
        offsetKind = 'approx';
      }
    }
  }

  return {
    strength,
    clipCount: inWindow.length,
    distinctCreators,
    offsetSeconds,
    offsetKind,
  };
}

function resolveConfidence(
  viewerSignal: SignalStrength,
  clipSignal: SignalStrength,
): AlertConfidence | null {
  if (viewerSignal === 'strong' && clipSignal === 'strong') return 'high';
  if (
    viewerSignal === 'strong' ||
    clipSignal === 'strong' ||
    (viewerSignal === 'weak' && clipSignal === 'weak')
  ) {
    return 'medium';
  }
  if (viewerSignal === 'weak' || clipSignal === 'weak') return 'low';
  return null;
}

function buildEvidenceString(
  capability: SignalCapability,
  viewer: ReturnType<typeof evaluateViewerSpike>,
  clip: ReturnType<typeof evaluateClipVelocity>,
  config: LiveMomentConfig,
): string {
  const parts: string[] = [];
  const windowMins = Math.max(1, Math.round(config.clipWindowMs / 60_000));
  const recentMins = Math.max(1, Math.round(config.recentExcludeMs / 60_000));

  if (clip.strength !== 'none') {
    parts.push(`${clip.clipCount} clips from ${clip.distinctCreators} creators in ${windowMins}m`);
  }
  if (viewer.strength !== 'none') {
    const pct = Math.round(viewer.gainPct * 100);
    const gain = Math.round(viewer.gain);
    parts.push(`viewers +${pct}% (+${gain}) in ${recentMins}m`);
  }
  if (clip.offsetSeconds !== null && clip.offsetKind !== null) {
    parts.push(formatOffsetLabel(clip.offsetSeconds, clip.offsetKind));
  }
  if (capability === 'viewer_spike_only') {
    parts.push('viewer spike only (no clip signal)');
  }
  return parts.length > 0 ? parts.join(' · ') : 'No live moment threshold met';
}

/**
 * Evaluates whether a live stream is experiencing a clippable moment using
 * rolling baseline viewer spikes and (on Twitch) distinct-creator clip velocity.
 */
export function evaluateLiveMoment(
  input: LiveMomentInput,
  config: LiveMomentConfig = DEFAULT_LIVE_MOMENT_CONFIG,
): LiveMomentEvaluation {
  const capability: SignalCapability =
    input.platform === 'twitch' ? 'viewer_and_clips' : 'viewer_spike_only';
  const evalMs = Date.parse(input.evaluatedAt);

  if (!input.isLive || !Number.isFinite(evalMs)) {
    return {
      detected: false,
      inCooldown: false,
      confidence: null,
      score: 0,
      signalCapability: capability,
      viewerSignal: 'none',
      clipSignal: 'none',
      baselineViewers: 0,
      currentViewers: 0,
      viewerGain: 0,
      viewerGainPct: 0,
      clipCount: 0,
      distinctClipCreators: 0,
      offsetSeconds: null,
      offsetKind: null,
      evidence: 'Stream is offline',
    };
  }

  if (input.lastAlertAt) {
    const lastMs = Date.parse(input.lastAlertAt);
    if (Number.isFinite(lastMs) && evalMs - lastMs < config.cooldownMs) {
      return {
        detected: false,
        inCooldown: true,
        confidence: null,
        score: 0,
        signalCapability: capability,
        viewerSignal: 'none',
        clipSignal: 'none',
        baselineViewers: 0,
        currentViewers: 0,
        viewerGain: 0,
        viewerGainPct: 0,
        clipCount: 0,
        distinctClipCreators: 0,
        offsetSeconds: null,
        offsetKind: null,
        evidence: 'Per-stream cooldown active',
      };
    }
  }

  const viewer = evaluateViewerSpike(input, evalMs, config);
  const clip = evaluateClipVelocity(input, evalMs, config);
  const confidence = resolveConfidence(viewer.strength, clip.strength);

  const signalPoints: Record<SignalStrength, number> = { none: 0, weak: 1, strong: 2 };
  const score = signalPoints[viewer.strength] + signalPoints[clip.strength];

  return {
    detected: confidence !== null,
    inCooldown: false,
    confidence,
    score,
    signalCapability: capability,
    viewerSignal: viewer.strength,
    clipSignal: clip.strength,
    baselineViewers: viewer.baselineViewers,
    currentViewers: viewer.currentViewers,
    viewerGain: viewer.gain,
    viewerGainPct: viewer.gainPct,
    clipCount: clip.clipCount,
    distinctClipCreators: clip.distinctCreators,
    offsetSeconds: clip.offsetSeconds,
    offsetKind: clip.offsetKind,
    evidence: buildEvidenceString(capability, viewer, clip, config),
  };
}

export interface VodReadyInput {
  readonly platform: Platform;
  readonly streamTitle: string;
  readonly vodId: string | null;
  readonly vodUrl: string | null;
  readonly previouslyNotified: boolean;
}

export interface VodReadyEvaluation {
  readonly detected: boolean;
  readonly confidence: AlertConfidence | null;
  readonly reason: string;
}

/**
 * Detects when a stream's VOD becomes available for clipping.
 */
export function evaluateVodReady(input: VodReadyInput): VodReadyEvaluation {
  if (input.previouslyNotified) {
    return { detected: false, confidence: null, reason: 'VOD-ready alert already sent' };
  }
  if (!input.vodId || !input.vodUrl || !input.vodUrl.startsWith('https://')) {
    return { detected: false, confidence: null, reason: 'VOD not yet available' };
  }
  return {
    detected: true,
    confidence: 'medium',
    reason: `VOD ready on ${input.platform}: ${input.streamTitle}`,
  };
}

export interface EscalationInput {
  readonly type: AlertType;
  readonly confidence: AlertConfidence;
  readonly createdAt: string;
  readonly now: string;
  readonly isClaimed: boolean;
  readonly remindedAt: string | null;
}

export interface EscalationDecision {
  readonly shouldEscalate: boolean;
  readonly reason: string;
}

/**
 * Enforces a maximum of 1 escalation reminder for unclaimed High Live Moments
 * or Breakout/Viral Rising alerts past the configured threshold.
 */
export function shouldEscalateUnclaimed(
  input: EscalationInput,
  escalationDelayMs: number = DEFAULT_LIVE_MOMENT_CONFIG.escalationDelayMs,
): EscalationDecision {
  if (input.isClaimed) {
    return { shouldEscalate: false, reason: 'Already claimed' };
  }
  if (input.remindedAt !== null) {
    return { shouldEscalate: false, reason: 'Escalation reminder already sent (1x max)' };
  }
  const eligible =
    (input.type === 'live_moment' && input.confidence === 'high') ||
    input.type === 'breakout' ||
    input.type === 'viral';

  if (!eligible) {
    return { shouldEscalate: false, reason: 'Alert tier/type not eligible for escalation' };
  }

  const createdMs = Date.parse(input.createdAt);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs)) {
    return { shouldEscalate: false, reason: 'Invalid timestamp' };
  }

  if (nowMs - createdMs < escalationDelayMs) {
    return { shouldEscalate: false, reason: 'Escalation delay not yet elapsed' };
  }

  return {
    shouldEscalate: true,
    reason: `Unclaimed ${input.type} (${input.confidence}) past ${Math.round(escalationDelayMs / 60_000)}m threshold`,
  };
}

export interface ReplayTickResult {
  readonly evaluatedAt: string;
  readonly evaluation: LiveMomentEvaluation;
}

export interface LiveMomentReplayResult {
  readonly ticksEvaluated: number;
  readonly triggered: readonly ReplayTickResult[];
  readonly countsByConfidence: Record<AlertConfidence, number>;
}

/**
 * Pure replay/backtest harness for evaluating a stream's historical samples and clips.
 */
export function replayLiveMoments(
  params: {
    readonly platform: Platform;
    readonly streamStartedAt: string;
    readonly evaluationTimestamps: readonly string[];
    readonly viewerSamples: readonly LiveViewerSample[];
    readonly clips: readonly LiveClipSample[];
    readonly usualClipsPerWindow?: number | null;
  },
  config: LiveMomentConfig = DEFAULT_LIVE_MOMENT_CONFIG,
): LiveMomentReplayResult {
  let lastAlertAt: string | null = null;
  const triggered: ReplayTickResult[] = [];
  const countsByConfidence: Record<AlertConfidence, number> = { low: 0, medium: 0, high: 0 };

  for (const evaluatedAt of params.evaluationTimestamps) {
    const evaluation = evaluateLiveMoment(
      {
        platform: params.platform,
        isLive: true,
        streamStartedAt: params.streamStartedAt,
        evaluatedAt,
        viewerSamples: params.viewerSamples,
        recentClips: params.clips,
        usualClipsPerWindow: params.usualClipsPerWindow,
        lastAlertAt,
      },
      config,
    );

    if (evaluation.detected && evaluation.confidence) {
      lastAlertAt = evaluatedAt;
      countsByConfidence[evaluation.confidence] += 1;
      triggered.push({ evaluatedAt, evaluation });
    }
  }

  return {
    ticksEvaluated: params.evaluationTimestamps.length,
    triggered,
    countsByConfidence,
  };
}
