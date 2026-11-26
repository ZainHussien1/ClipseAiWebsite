import { Hono } from 'hono';
import {
  AppError,
  hasRoleAtLeast,
  platformSchema,
  type IntegrationDetail,
  type IntegrationStatus,
  type Platform,
} from '@clipse/core';
import { z } from 'zod';
import type { EdgeBindings, EdgeVariables } from '../app.js';

interface SubAggRow {
  platform: Platform;
  cnt: number;
  next_lease: string | null;
}

interface MetricAggRow {
  platform: Platform;
  ops: number;
}

const SETUP_STEPS: Record<Platform, readonly string[]> = {
  youtube: [
    'Optional for RSS mode: RSS public feeds work with zero API key.',
    'Create a YouTube Data API v3 key in Google Cloud Console and add YOUTUBE_API_KEY via wrangler secret put.',
    'Set YOUTUBE_WEBSUB_SECRET and subscribe channels to the WebSub callback URL below.',
  ],
  twitch: [
    'Register an application at dev.twitch.tv/console and set the OAuth redirect URL below.',
    'Set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and TWITCH_EVENTSUB_SECRET via wrangler secret put.',
    'Point EventSub stream.online / stream.offline webhooks to the Webhook URL below.',
  ],
  kick: [
    'Create a Kick Developer App at kick.com/settings/developer with the OAuth redirect URL below.',
    'Set KICK_CLIENT_ID and KICK_CLIENT_SECRET via wrangler secret put (public key is fetched dynamically).',
    'Subscribe livestream.status.updated webhooks to the Webhook URL below.',
  ],
};

function buildIntegrationDetail(
  platform: Platform,
  env: EdgeBindings,
  origin: string,
  subs: Map<Platform, SubAggRow>,
  metrics: Map<Platform, number>,
): IntegrationDetail {
  const sub = subs.get(platform);
  const quotaUsedToday = metrics.get(platform) ?? 0;

  if (platform === 'youtube') {
    const hasKey = Boolean(env.YOUTUBE_API_KEY);
    const hasWebSub = Boolean(env.YOUTUBE_WEBSUB_SECRET);
    return {
      platform: 'youtube',
      status: 'healthy',
      mode: hasKey ? 'Data API v3 + WebSub' : 'Public Atom RSS (keyless)',
      secretPresence: {
        YOUTUBE_API_KEY: hasKey,
        YOUTUBE_WEBSUB_SECRET: hasWebSub,
      },
      quotaUsedToday,
      quotaLimitDaily: 10_000,
      subscriptionCount: sub?.cnt ?? 0,
      nextLeaseRenewalAt: sub?.next_lease ?? null,
      callbackUrls: {
        webhookUrl: `${origin}/hooks/youtube`,
        oauthCallbackUrl: null,
      },
      setupSteps: [...SETUP_STEPS.youtube],
    };
  }

  if (platform === 'twitch') {
    const hasId = Boolean(env.TWITCH_CLIENT_ID);
    const hasSecret = Boolean(env.TWITCH_CLIENT_SECRET);
    const hasEventSub = Boolean(env.TWITCH_EVENTSUB_SECRET);
    const status: IntegrationStatus =
      hasId && hasSecret ? 'healthy' : 'not_configured';
    return {
      platform: 'twitch',
      status,
      mode: hasId && hasSecret ? 'Helix API + EventSub' : 'Not configured',
      secretPresence: {
        TWITCH_CLIENT_ID: hasId,
        TWITCH_CLIENT_SECRET: hasSecret,
        TWITCH_EVENTSUB_SECRET: hasEventSub,
      },
      quotaUsedToday,
      quotaLimitDaily: 5_000,
      subscriptionCount: sub?.cnt ?? 0,
      nextLeaseRenewalAt: sub?.next_lease ?? null,
      callbackUrls: {
        webhookUrl: `${origin}/hooks/twitch`,
        oauthCallbackUrl: `${origin}/api/v1/integrations/twitch/callback`,
      },
      setupSteps: [...SETUP_STEPS.twitch],
    };
  }

  const hasId = Boolean(env.KICK_CLIENT_ID);
  const hasSecret = Boolean(env.KICK_CLIENT_SECRET);
  const hasPubKey = Boolean(env.KICK_PUBLIC_KEY);
  const status: IntegrationStatus =
    hasId && hasSecret ? 'healthy' : 'not_configured';
  return {
    platform: 'kick',
    status,
    mode: hasId && hasSecret ? 'Kick Public API v1 + Webhooks' : 'Not configured',
    secretPresence: {
      KICK_CLIENT_ID: hasId,
      KICK_CLIENT_SECRET: hasSecret,
      KICK_PUBLIC_KEY: hasPubKey,
    },
    quotaUsedToday,
    quotaLimitDaily: 5_000,
    subscriptionCount: sub?.cnt ?? 0,
    nextLeaseRenewalAt: sub?.next_lease ?? null,
    callbackUrls: {
      webhookUrl: `${origin}/hooks/kick`,
      oauthCallbackUrl: `${origin}/api/v1/integrations/kick/callback`,
    },
    setupSteps: [...SETUP_STEPS.kick],
  };
}

export function createAdminIntegrationsRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('Integrations require Admin or Owner role');
    }

    const today = new Date().toISOString().slice(0, 10);
    const [subRows, metricRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT platform, COUNT(*) AS cnt, MIN(lease_expires_at) AS next_lease
         FROM webhook_subscriptions
         WHERE status = 'active'
         GROUP BY platform`,
      ).all<SubAggRow>(),
      c.env.DB.prepare(
        `SELECT platform, COALESCE(SUM(pushes_received + reconcile_runs), 0) AS ops
         FROM ingestion_metrics
         WHERE metric_date = ?
         GROUP BY platform`,
      )
        .bind(today)
        .all<MetricAggRow>(),
    ]);

    const subs = new Map((subRows.results ?? []).map((r) => [r.platform, r]));
    const metrics = new Map((metricRows.results ?? []).map((r) => [r.platform, r.ops]));
    const origin = new URL(c.req.url).origin;

    const integrations: IntegrationDetail[] = (['youtube', 'twitch', 'kick'] as const).map(
      (p) => buildIntegrationDetail(p, c.env, origin, subs, metrics),
    );

    return c.json({
      integrations,
      extraSecrets: {
        DISCORD_WEBHOOK_URL: Boolean(c.env.DISCORD_WEBHOOK_URL),
        GEMINI_API_KEY: Boolean(c.env.GEMINI_API_KEY),
      },
      source: 'Cloudflare Worker Config',
      asOf: new Date().toISOString(),
    });
  });

  router.post('/:platform/verify', async (c) => {
    const principal = c.get('principal');
    if (!hasRoleAtLeast(principal.role, 'Admin')) {
      throw AppError.forbidden('Integration verification requires Admin or Owner role');
    }

    const parsedPlatform = platformSchema.safeParse(c.req.param('platform'));
    if (!parsedPlatform.success) {
      throw AppError.badRequest('Invalid platform');
    }
    const platform = parsedPlatform.data;
    const nowIso = new Date().toISOString();

    let ok = false;
    let status: IntegrationStatus = 'not_configured';
    let message = '';

    if (c.env.ENGINE && typeof c.env.ENGINE.verifyProviderConnection === 'function') {
      const result = await c.env.ENGINE.verifyProviderConnection(platform);
      ok = result.ok;
      status = result.status;
      message = result.message;
    } else if (platform === 'youtube') {
      ok = true;
      status = 'healthy';
      message = c.env.YOUTUBE_API_KEY
        ? 'YouTube Data API v3 key configured'
        : 'YouTube Public Atom RSS active (keyless)';
    } else if (platform === 'twitch') {
      const configured = Boolean(c.env.TWITCH_CLIENT_ID && c.env.TWITCH_CLIENT_SECRET);
      ok = configured;
      status = configured ? 'healthy' : 'not_configured';
      message = configured
        ? 'Twitch client credentials configured'
        : 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET missing';
    } else {
      const configured = Boolean(c.env.KICK_CLIENT_ID && c.env.KICK_CLIENT_SECRET);
      ok = configured;
      status = configured ? 'healthy' : 'not_configured';
      message = configured
        ? 'Kick client credentials configured'
        : 'KICK_CLIENT_ID / KICK_CLIENT_SECRET missing';
    }

    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'integration.verified', 'provider', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        principal.workspaceId,
        principal.userId,
        platform,
        JSON.stringify({ ok, status }),
        nowIso,
      )
      .run();

    return c.json({
      ok,
      platform,
      status,
      message,
      checkedAt: nowIso,
    });
  });

  return router;
}

const callbackQuerySchema = z.object({
  code: z.string().max(512).optional(),
  state: z.string().max(256).optional(),
  error: z.string().max(128).optional(),
});

export function createIntegrationsCallbackRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/:platform/callback', (c) => {
    const parsedPlatform = z
      .enum(['twitch', 'kick'])
      .safeParse(c.req.param('platform'));
    if (!parsedPlatform.success) {
      throw AppError.badRequest('Unsupported OAuth callback provider');
    }

    const q = callbackQuerySchema.safeParse(c.req.query());
    const hasError = !q.success || Boolean(q.data.error) || !q.data.code;
    const statusParam = hasError ? 'callback_error' : 'callback_ok';
    const origin = new URL(c.req.url).origin;
    const target = `${origin}/settings?tab=integrations&provider=${parsedPlatform.data}&status=${statusParam}`;

    return c.redirect(target, 302);
  });

  return router;
}
