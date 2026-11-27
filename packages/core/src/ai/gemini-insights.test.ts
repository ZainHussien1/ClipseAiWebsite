import { describe, expect, it, vi } from 'vitest';
import {
  formatDeterministicDailyNarrative,
  GeminiInsightsProvider,
  validateNumericGrounding,
} from './gemini-insights.js';

describe('GeminiInsightsProvider & numeric grounding', () => {
  const sampleInput = {
    dateIso: '2026-11-27',
    workspaceName: 'Secret Studio Name Never Sent',
    metrics: {
      alertsCount: 4,
      claimsCount: 3,
      clippedCount: 2,
      clipsLoggedCount: 1,
    },
  };

  it('validates numeric grounding strictly against deterministic input', () => {
    expect(
      validateNumericGrounding(
        'On 2026-11-27, the team saw 4 alerts, 3 claims, 2 clipped, and 1 clips logged.',
        sampleInput,
      ),
    ).toEqual({ valid: true, ungroundedNumbers: [] });

    expect(
      validateNumericGrounding(
        'On 2026-11-27, velocity jumped 250% with 4 alerts and 99 views.',
        sampleInput,
      ),
    ).toEqual({ valid: false, ungroundedNumbers: ['250', '99'] });

    expect(validateNumericGrounding('   ', sampleInput)).toEqual({
      valid: false,
      ungroundedNumbers: [],
    });
  });

  it('falls back to deterministic template when GEMINI_API_KEY is missing', async () => {
    const provider = new GeminiInsightsProvider({ enabled: true });
    expect(provider.isEnabled()).toBe(false);

    const res = await provider.summarizeDailyDigestWithResult(sampleInput);
    expect(res.aiInsightsUsed).toBe(false);
    expect(res.status).toBe('fallback_no_key');
    expect(res.narrative).toBe(formatDeterministicDailyNarrative(sampleInput));
  });

  it('calls Cloudflare AI Gateway with public metadata only and rejects ungrounded numbers', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyStr = String(init?.body ?? '');
      // Ensure private workspaceName is NEVER sent to Gemini
      expect(bodyStr).not.toContain('Secret Studio Name Never Sent');
      expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-gem-key');
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Hallucinated 77% lift with 4 alerts and 3 claims.',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new GeminiInsightsProvider({
      apiKey: 'test-gem-key',
      enabled: true,
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const res = await provider.summarizeDailyDigestWithResult(sampleInput);
    expect(res.aiInsightsUsed).toBe(false);
    expect(res.status).toBe('fallback_ungrounded');
    expect(res.fallbackReason).toContain('77');
    expect(res.narrative).toBe(formatDeterministicDailyNarrative(sampleInput));
  });

  it('accepts grounded Gemini response and caches by content key', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'On 2026-11-27: 4 alerts led to 3 claims, 2 clipped, and 1 clip logged.',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new GeminiInsightsProvider({
      apiKey: 'test-gem-key',
      enabled: true,
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const first = await provider.summarizeDailyDigestWithResult(sampleInput);
    expect(first.aiInsightsUsed).toBe(true);
    expect(first.status).toBe('used');
    expect(first.narrative).toContain('4 alerts led to 3 claims');

    const second = await provider.summarizeDailyDigestWithResult(sampleInput);
    expect(second.aiInsightsUsed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
