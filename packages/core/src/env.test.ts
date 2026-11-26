import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('defaults ENVIRONMENT to local and AI_INSIGHTS_ENABLED to false', () => {
    const env = parseEnv({});
    expect(env.ENVIRONMENT).toBe('local');
    expect(env.AI_INSIGHTS_ENABLED).toBe(false);
    expect(env.DISCORD_WEBHOOK_URL).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it('parses valid local env with optional https Discord webhook', () => {
    const env = parseEnv({
      ENVIRONMENT: 'local',
      AI_INSIGHTS_ENABLED: 'false',
      DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc',
      ACCESS_TEAM_DOMAIN: '',
      ACCESS_AUD: '',
    });
    expect(env.ENVIRONMENT).toBe('local');
    expect(env.AI_INSIGHTS_ENABLED).toBe(false);
    expect(env.DISCORD_WEBHOOK_URL).toBe('https://discord.com/api/webhooks/123/abc');
    expect(env.ACCESS_TEAM_DOMAIN).toBeUndefined();
    expect(env.ACCESS_AUD).toBeUndefined();
  });

  it('rejects non-https DISCORD_WEBHOOK_URL and invalid URLs', () => {
    expect(() =>
      parseEnv({ DISCORD_WEBHOOK_URL: 'http://discord.com/api/webhooks/1/2' }),
    ).toThrow();
    expect(() => parseEnv({ DISCORD_WEBHOOK_URL: 'not-a-url' })).toThrow();
  });

  it('requires ACCESS_TEAM_DOMAIN and ACCESS_AUD in staging and prod', () => {
    expect(() => parseEnv({ ENVIRONMENT: 'staging' })).toThrow();
    expect(() =>
      parseEnv({
        ENVIRONMENT: 'prod',
        ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      }),
    ).toThrow();

    const prod = parseEnv({
      ENVIRONMENT: 'prod',
      ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      ACCESS_AUD: 'aud-tag-123',
    });
    expect(prod.ENVIRONMENT).toBe('prod');
    expect(prod.ACCESS_TEAM_DOMAIN).toBe('team.cloudflareaccess.com');
    expect(prod.ACCESS_AUD).toBe('aud-tag-123');
  });

  it('requires GEMINI_API_KEY when AI_INSIGHTS_ENABLED is true', () => {
    expect(() => parseEnv({ AI_INSIGHTS_ENABLED: 'true' })).toThrow();
    const enabled = parseEnv({
      AI_INSIGHTS_ENABLED: true,
      GEMINI_API_KEY: 'test-key-placeholder',
    });
    expect(enabled.AI_INSIGHTS_ENABLED).toBe(true);
    expect(enabled.GEMINI_API_KEY).toBe('test-key-placeholder');
  });
});
