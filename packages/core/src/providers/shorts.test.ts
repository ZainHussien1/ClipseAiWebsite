import { describe, expect, it } from 'vitest';
import { classifyShort } from './shorts.js';

describe('classifyShort', () => {
  it('classifies /shorts/ URLs even without duration', () => {
    expect(
      classifyShort({ url: 'https://www.youtube.com/shorts/abcDEF12345', title: 'Clip' }),
    ).toEqual({
      isShort: true,
      reason: 'url_shorts_path',
    });
  });

  it('classifies <=60s videos as Shorts', () => {
    expect(classifyShort({ durationSec: 58, url: 'https://www.youtube.com/watch?v=123' })).toEqual({
      isShort: true,
      reason: 'duration_le_60',
    });
  });

  it('classifies 61-180s videos only with #shorts hashtag', () => {
    expect(
      classifyShort({
        durationSec: 120,
        url: 'https://www.youtube.com/watch?v=123',
        title: 'Insane clutch #shorts',
      }),
    ).toEqual({
      isShort: true,
      reason: 'duration_le_180_and_hashtag',
    });

    expect(
      classifyShort({
        durationSec: 120,
        url: 'https://www.youtube.com/watch?v=123',
        title: 'Quick channel update',
      }),
    ).toEqual({
      isShort: false,
      reason: 'not_short',
    });
  });

  it('returns unknown_duration when duration is missing and URL is not /shorts/', () => {
    expect(
      classifyShort({ url: 'https://www.youtube.com/watch?v=123', title: 'Stream highlights' }),
    ).toEqual({
      isShort: false,
      reason: 'unknown_duration',
    });
  });
});
