import { describe, expect, it } from 'vitest';
import {
  classifyShort,
  parseAspectRatio,
  type ShortClassificationInput,
  type ShortsClassification,
} from './shorts.js';

interface LabelledShortCase {
  readonly channel: string;
  readonly input: ShortClassificationInput;
  readonly expected: ShortsClassification;
}

function buildLabelledDataset(): readonly LabelledShortCase[] {
  const cases: LabelledShortCase[] = [];

  // 1. Canonical /shorts/ URLs across durations (15s-180s and unknown duration from WebSub) - 25 items
  const shortDurations = [15, 28, 45, 59, 61, 75, 90, 118, 145, 179, 180, null, undefined];
  for (let i = 0; i < 25; i += 1) {
    const dur = shortDurations[i % shortDurations.length];
    cases.push({
      channel: `ch-shorts-${(i % 4) + 1}`,
      input: {
        url: `https://www.youtube.com/shorts/shrt_${String(i).padStart(4, '0')}`,
        title: `Highlight clip #${i}`,
        durationSec: dur,
      },
      expected: 'short',
    });
  }

  // 2. Vertical / square Shorts up to 180s on /watch?v= URLs (including 61-180s range) - 25 items
  const ratios: Array<number | string> = ['9:16', '3:4', '1:1', 0.5625, 'vertical', 'square'];
  const midAndShortDurations = [18, 42, 60, 65, 88, 120, 155, 180];
  for (let i = 0; i < 25; i += 1) {
    cases.push({
      channel: `ch-vertical-${(i % 3) + 1}`,
      input: {
        url: `https://www.youtube.com/watch?v=vert_${String(i).padStart(4, '0')}`,
        title: i % 2 === 0 ? `Creator moment ${i} #shorts` : `Creator moment ${i}`,
        durationSec: midAndShortDurations[i % midAndShortDurations.length],
        aspectRatio: ratios[i % ratios.length],
      },
      expected: 'short',
    });
  }

  // 3. Standard Videos > 180s (including clickbait #shorts in title) - 25 items
  const longDurations = [181, 210, 340, 600, 1245, 3600];
  for (let i = 0; i < 25; i += 1) {
    cases.push({
      channel: `ch-long-${(i % 5) + 1}`,
      input: {
        url: `https://www.youtube.com/watch?v=long_${String(i).padStart(4, '0')}`,
        title: i % 5 === 0 ? `Best #shorts compilation ${i}` : `Full match review ${i}`,
        durationSec: longDurations[i % longDurations.length],
        aspectRatio: i % 3 === 0 ? '16:9' : undefined,
      },
      expected: 'video',
    });
  }

  // 4. Short horizontal 16:9 Videos (<= 180s teasers/trailers/announcements) - 20 items
  const trailerDurations = [22, 45, 58, 75, 110, 145, 178];
  for (let i = 0; i < 20; i += 1) {
    cases.push({
      channel: `ch-trailer-${(i % 3) + 1}`,
      input: {
        url: `https://www.youtube.com/watch?v=trlr_${String(i).padStart(4, '0')}`,
        title: `Official teaser trailer ${i}`,
        durationSec: trailerDurations[i % trailerDurations.length],
        aspectRatio: i % 2 === 0 ? '16:9' : 1.7778,
      },
      expected: 'video',
    });
  }

  // 5. Ambiguous items: unknown duration or <=180s with no /shorts/ URL, no aspect ratio, no #shorts - 15 items
  for (let i = 0; i < 15; i += 1) {
    const unknownDur = i < 10 ? null : 55 + (i - 10) * 20;
    cases.push({
      channel: `ch-ambig-${(i % 3) + 1}`,
      input: {
        url: `https://www.youtube.com/watch?v=ambg_${String(i).padStart(4, '0')}`,
        title: `Channel upload ${i}`,
        durationSec: unknownDur,
      },
      expected: 'unclassified',
    });
  }

  return cases;
}

describe('classifyShort', () => {
  it('classifies /shorts/ URLs up to 180s and when duration is missing', () => {
    expect(
      classifyShort({ url: 'https://www.youtube.com/shorts/abcDEF12345', title: 'Clip' }),
    ).toEqual({
      classification: 'short',
      isShort: true,
      reason: 'url_shorts_path',
    });

    expect(
      classifyShort({
        url: 'https://m.youtube.com/shorts/abcDEF12345?feature=share',
        durationSec: 175,
      }),
    ).toEqual({
      classification: 'short',
      isShort: true,
      reason: 'url_shorts_path',
    });
  });

  it('never guesses <=60s without vertical aspect ratio, /shorts/ URL, or #shorts tag', () => {
    expect(
      classifyShort({
        durationSec: 45,
        url: 'https://www.youtube.com/watch?v=123',
        title: 'Channel teaser',
      }),
    ).toEqual({
      classification: 'unclassified',
      isShort: false,
      reason: 'ambiguous_duration_le_180',
    });

    expect(
      classifyShort({
        durationSec: 45,
        url: 'https://www.youtube.com/watch?v=123',
        title: 'Channel teaser',
        aspectRatio: '16:9',
      }),
    ).toEqual({
      classification: 'video',
      isShort: false,
      reason: 'horizontal_video',
    });
  });

  it('classifies 61-180s vertical/square or #shorts items as short and >180s as video', () => {
    expect(
      classifyShort({
        durationSec: 165,
        url: 'https://www.youtube.com/watch?v=123',
        title: 'Vertical highlight',
        aspectRatio: '9:16',
      }),
    ).toEqual({
      classification: 'short',
      isShort: true,
      reason: 'vertical_within_180s',
    });

    expect(
      classifyShort({
        durationSec: 181,
        url: 'https://www.youtube.com/watch?v=123',
        title: 'Compilation #shorts',
        aspectRatio: '9:16',
      }),
    ).toEqual({
      classification: 'video',
      isShort: false,
      reason: 'duration_gt_180',
    });
  });

  it('returns unclassified when duration is unknown and URL is not /shorts/', () => {
    expect(
      classifyShort({
        url: 'https://www.youtube.com/watch?v=123',
        title: 'Stream highlights',
        durationSec: null,
        aspectRatio: '9:16',
      }),
    ).toEqual({
      classification: 'unclassified',
      isShort: false,
      reason: 'unknown_duration',
    });
  });

  it('parses numeric and string aspect ratios safely', () => {
    expect(parseAspectRatio('9:16')).toBeCloseTo(9 / 16, 4);
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9, 4);
    expect(parseAspectRatio('1080x1920')).toBeCloseTo(9 / 16, 4);
    expect(parseAspectRatio('invalid')).toBeNull();
  });

  it('achieves >= 98% precision on >= 100 labelled items across channels', () => {
    const dataset = buildLabelledDataset();
    expect(dataset.length).toBeGreaterThanOrEqual(100);

    let correct = 0;
    let shortPredicted = 0;
    let shortTruePositive = 0;
    let videoPredicted = 0;
    let videoTruePositive = 0;

    for (const item of dataset) {
      const actual = classifyShort(item.input).classification;
      if (actual === item.expected) correct += 1;
      if (actual === 'short') {
        shortPredicted += 1;
        if (item.expected === 'short') shortTruePositive += 1;
      }
      if (actual === 'video') {
        videoPredicted += 1;
        if (item.expected === 'video') videoTruePositive += 1;
      }
    }

    const overallAccuracy = (correct / dataset.length) * 100;
    const shortPrecision = shortPredicted > 0 ? (shortTruePositive / shortPredicted) * 100 : 0;
    const videoPrecision = videoPredicted > 0 ? (videoTruePositive / videoPredicted) * 100 : 0;

    console.info(
      `[shorts-eval] n=${dataset.length} accuracy=${overallAccuracy.toFixed(2)}% shortPrecision=${shortPrecision.toFixed(2)}% videoPrecision=${videoPrecision.toFixed(2)}%`,
    );

    expect(overallAccuracy).toBeGreaterThanOrEqual(98);
    expect(shortPrecision).toBeGreaterThanOrEqual(98);
    expect(videoPrecision).toBeGreaterThanOrEqual(98);
  });
});
