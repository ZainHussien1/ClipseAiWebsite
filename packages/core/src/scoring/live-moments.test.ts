import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_MOMENT_CONFIG,
  evaluateLiveMoment,
  evaluateVodReady,
  replayLiveMoments,
  shouldEscalateUnclaimed,
  type LiveClipSample,
  type LiveViewerSample,
} from './live-moments.js';

function makeViewerSeries(
  startIso: string,
  counts: readonly number[],
  stepMs = 60_000,
): LiveViewerSample[] {
  const base = Date.parse(startIso);
  return counts.map((viewers, idx) => ({
    sampledAt: new Date(base + idx * stepMs).toISOString(),
    viewers,
  }));
}

function lastSampleTime(samples: readonly LiveViewerSample[]): string {
  return samples.at(-1)?.sampledAt ?? '';
}

describe('evaluateLiveMoment', () => {
  it('detects High confidence on Twitch when viewer spike and distinct-creator clip velocity are both strong', () => {
    const start = '2026-11-26T10:00:00Z';
    // 20 minutes of ~1000 viewers, then sustained spike to 1450 (+45%)
    const counts = [
      1000, 1020, 990, 1010, 1000, 1005, 995, 1000, 1010, 1000, 1000, 1020, 990, 1010, 1000, 1000,
      1100, 1450, 1480,
    ];
    const samples = makeViewerSeries(start, counts);
    const evalTime = lastSampleTime(samples);

    const clips: LiveClipSample[] = [
      { id: 'c1', createdAt: '2026-11-26T10:16:30Z', creatorName: 'Alice' },
      { id: 'c2', createdAt: '2026-11-26T10:17:00Z', creatorName: 'Bob' },
      { id: 'c3', createdAt: '2026-11-26T10:17:20Z', creatorName: 'Charlie' },
      { id: 'c4', createdAt: '2026-11-26T10:17:50Z', creatorName: 'Dana' },
      { id: 'c5', createdAt: '2026-11-26T10:18:00Z', creatorName: 'Alice' },
    ];

    const res = evaluateLiveMoment({
      platform: 'twitch',
      isLive: true,
      streamStartedAt: start,
      evaluatedAt: evalTime,
      viewerSamples: samples,
      recentClips: clips,
    });

    expect(res.detected).toBe(true);
    expect(res.confidence).toBe('high');
    expect(res.distinctClipCreators).toBe(4);
    expect(res.offsetKind).toBe('approx');
    expect(res.evidence).toContain('approx.');
    expect(res.evidence).toContain('4 creators');
    expect(res.evidence).toContain('viewers +');
  });

  it('prevents a single clip spammer from triggering clip velocity', () => {
    const start = '2026-11-26T10:00:00Z';
    const samples = makeViewerSeries(start, [500, 500, 500, 500, 500, 500, 500, 500]);
    const evalTime = lastSampleTime(samples);

    const spamClips: LiveClipSample[] = Array.from({ length: 8 }, (_, idx) => ({
      id: `spam-${idx}`,
      createdAt: '2026-11-26T10:06:30Z',
      creatorName: 'SpamUser',
    }));

    const res = evaluateLiveMoment({
      platform: 'twitch',
      isLive: true,
      streamStartedAt: start,
      evaluatedAt: evalTime,
      viewerSamples: samples,
      recentClips: spamClips,
    });

    expect(res.detected).toBe(false);
    expect(res.distinctClipCreators).toBe(1);
    expect(res.clipSignal).toBe('none');
  });

  it('uses exact vod_offset when available on Twitch clips', () => {
    const start = '2026-11-26T10:00:00Z';
    const samples = makeViewerSeries(start, [200, 200, 200, 200, 200, 200]);
    const evalTime = lastSampleTime(samples);

    const clips: LiveClipSample[] = [
      { id: 'c1', createdAt: '2026-11-26T10:04:00Z', creatorName: 'A', vodOffsetSeconds: 240 },
      { id: 'c2', createdAt: '2026-11-26T10:04:30Z', creatorName: 'B', vodOffsetSeconds: 270 },
    ];

    const res = evaluateLiveMoment({
      platform: 'twitch',
      isLive: true,
      streamStartedAt: start,
      evaluatedAt: evalTime,
      viewerSamples: samples,
      recentClips: clips,
    });

    expect(res.detected).toBe(true);
    expect(res.confidence).toBe('low');
    expect(res.offsetKind).toBe('exact');
    expect(res.offsetSeconds).toBe(270);
    expect(res.evidence).toContain('vod_offset');
  });

  it('flags YouTube Live and Kick as viewer_spike_only and caps at Medium confidence', () => {
    const start = '2026-11-26T10:00:00Z';
    const counts = [200, 200, 200, 200, 200, 200, 200, 200, 320, 340];
    const samples = makeViewerSeries(start, counts);
    const evalTime = lastSampleTime(samples);

    for (const platform of ['youtube', 'kick'] as const) {
      const res = evaluateLiveMoment({
        platform,
        isLive: true,
        streamStartedAt: start,
        evaluatedAt: evalTime,
        viewerSamples: samples,
      });

      expect(res.signalCapability).toBe('viewer_spike_only');
      expect(res.detected).toBe(true);
      expect(res.confidence).toBe('medium');
      expect(res.evidence).toContain('viewer spike only');
    }
  });

  it('enforces per-stream cooldown', () => {
    const start = '2026-11-26T10:00:00Z';
    const samples = makeViewerSeries(start, [200, 200, 200, 200, 200, 200, 200, 350, 360]);
    const evalTime = lastSampleTime(samples);

    const res = evaluateLiveMoment({
      platform: 'kick',
      isLive: true,
      streamStartedAt: start,
      evaluatedAt: evalTime,
      viewerSamples: samples,
      lastAlertAt: new Date(Date.parse(evalTime) - 2 * 60_000).toISOString(),
    });

    expect(res.detected).toBe(false);
    expect(res.inCooldown).toBe(true);
  });
});

describe('evaluateVodReady & shouldEscalateUnclaimed', () => {
  it('fires vod_ready once when https VOD URL appears', () => {
    expect(
      evaluateVodReady({
        platform: 'twitch',
        streamTitle: 'Late Night Ranked',
        vodId: 'vod-123',
        vodUrl: 'https://www.twitch.tv/videos/123',
        previouslyNotified: false,
      }).detected,
    ).toBe(true);

    expect(
      evaluateVodReady({
        platform: 'twitch',
        streamTitle: 'Late Night Ranked',
        vodId: 'vod-123',
        vodUrl: 'https://www.twitch.tv/videos/123',
        previouslyNotified: true,
      }).detected,
    ).toBe(false);
  });

  it('escalates unclaimed High Live Moment or Breakout/Viral at most once', () => {
    const createdAt = '2026-11-26T10:00:00Z';
    const afterDelay = new Date(
      Date.parse(createdAt) + DEFAULT_LIVE_MOMENT_CONFIG.escalationDelayMs + 1000,
    ).toISOString();

    expect(
      shouldEscalateUnclaimed({
        type: 'live_moment',
        confidence: 'high',
        createdAt,
        now: afterDelay,
        isClaimed: false,
        remindedAt: null,
      }).shouldEscalate,
    ).toBe(true);

    expect(
      shouldEscalateUnclaimed({
        type: 'live_moment',
        confidence: 'high',
        createdAt,
        now: afterDelay,
        isClaimed: false,
        remindedAt: afterDelay,
      }).shouldEscalate,
    ).toBe(false);

    expect(
      shouldEscalateUnclaimed({
        type: 'rising',
        confidence: 'medium',
        createdAt,
        now: afterDelay,
        isClaimed: false,
        remindedAt: null,
      }).shouldEscalate,
    ).toBe(false);
  });
});

describe('replayLiveMoments harness', () => {
  it('replays a stream timeline and respects cooldowns', () => {
    const start = '2026-11-26T10:00:00Z';
    const counts = [
      100, 100, 100, 100, 100, 100, 100, 100, 160, 165, 170, 175, 100, 100, 100, 100, 100, 100,
      100, 100, 180, 185,
    ];
    const samples = makeViewerSeries(start, counts);
    const replay = replayLiveMoments({
      platform: 'youtube',
      streamStartedAt: start,
      evaluationTimestamps: samples.map((s) => s.sampledAt),
      viewerSamples: samples,
      clips: [],
    });

    expect(replay.ticksEvaluated).toBe(samples.length);
    expect(replay.triggered.length).toBe(2);
    expect(replay.countsByConfidence.medium).toBe(2);
  });
});
