import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import {
  AppError,
  envSchema,
  type AuthProvider,
  type HealthStatus,
  type IngestQueueMessage,
  type IntegrationStatus,
  type Platform,
  type Principal,
} from '@clipse/core';
import { CloudflareAccessAuthProvider, resolvePrincipal } from './auth.js';
import {
  createKickHooksRouter,
  createTwitchHooksRouter,
  createYouTubeHooksRouter,
} from './hooks/index.js';
import { createAdminRouter } from './routes/admin.js';
import { createAlertsRouter } from './routes/alerts.js';
import { createAuthRouter } from './routes/auth.js';
import { createClaimsRouter } from './routes/claims.js';
import { createClipsRouter } from './routes/clips.js';
import { createCreatorsRouter } from './routes/creators.js';
import { createFeedRouter } from './routes/feed.js';
import {
  createAdminIntegrationsRouter,
  createIntegrationsCallbackRouter,
} from './routes/integrations.js';
import { createLiveRouter } from './routes/live.js';
import { createMissionControlRouter } from './routes/mission-control.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createProvidersRouter } from './routes/providers.js';
import { createReportsRouter } from './routes/reports.js';
import { createRisingRouter } from './routes/rising.js';
import { createSavedViewsRouter } from './routes/saved-views.js';
import { createSettingsRouter } from './routes/settings.js';
import { createSourcesRouter } from './routes/sources.js';
import { csrfMiddleware, securityHeadersMiddleware } from './security.js';
import {
  getSessionCookieName,
  parseCookie,
  resolveSessionSecret,
  SessionAuthProvider,
} from './session.js';
import type { WorkspaceDO } from './do/workspace.js';

export interface EngineSyncResult {
  readonly ok: boolean;
  readonly status: 'synced' | 'credentials_missing' | 'error';
  readonly itemsSynced: number;
  readonly channelName?: string | null;
  readonly resolvedExternalId?: string | null;
  readonly message?: string;
}

export interface EngineVerifyResult {
  readonly ok: boolean;
  readonly status: IntegrationStatus;
  readonly message: string;
}

export interface EngineServiceBinding {
  syncAccount?: (input: {
    platform: Platform;
    externalId: string;
  }) => Promise<EngineSyncResult>;
  verifyProviderConnection?: (platform: Platform) => Promise<EngineVerifyResult>;
}

export interface EdgeBindings {
  DB: D1Database;
  WORKSPACE_DO: DurableObjectNamespace<WorkspaceDO>;
  INGEST_QUEUE?: Queue<IngestQueueMessage>;
  NOTIFY_QUEUE?: Queue<unknown>;
  ENGINE?: EngineServiceBinding;
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
  AI_INSIGHTS_ENABLED?: string;
  AI_GATEWAY_URL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  SESSION_SECRET?: string;
  DISCORD_WEBHOOK_URL?: string;
  GEMINI_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  KICK_CLIENT_ID?: string;
  KICK_CLIENT_SECRET?: string;
  YOUTUBE_WEBSUB_SECRET?: string;
  TWITCH_EVENTSUB_SECRET?: string;
  KICK_PUBLIC_KEY?: string;
  WEBHOOK_ENCRYPTION_KEY?: string;
}

export interface EdgeVariables {
  principal: Principal;
}

export interface AppDependencies {
  authProviderFactory?: (env: EdgeBindings) => AuthProvider;
}

export function createApp(deps: AppDependencies = {}) {
  const app = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  app.use('*', securityHeadersMiddleware);
  app.use(
    '/api/*',
    cors({
      origin: (origin, c) => {
        if (!origin) return '';
        try {
          const reqOrigin = new URL(c.req.url).origin;
          if (origin === reqOrigin) return origin;
          const parsed = new URL(origin);
          if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
            return origin;
          }
        } catch {
          return '';
        }
        return '';
      },
      credentials: true,
    }),
  );
  app.use('/api/*', csrfMiddleware);

  // Public provider webhook endpoints (outside Access JWT & CSRF; signature + dedupe protected)
  app.route('/hooks/youtube', createYouTubeHooksRouter());
  app.route('/hooks/twitch', createTwitchHooksRouter());
  app.route('/hooks/kick', createKickHooksRouter());

  const authMiddleware: MiddlewareHandler<{
    Bindings: EdgeBindings;
    Variables: EdgeVariables;
  }> = async (c, next) => {
    const { provider, token } = getAuthRequestContext(c.env, c.req.raw, deps);
    const principal = await resolvePrincipal(c.env.DB, provider, token);
    c.set('principal', principal);
    await next();
  };

  // Auth status / session bootstrap (outside authMiddleware except /passphrase, inside CSRF)
  app.use('/api/v1/auth/passphrase', authMiddleware);
  app.route('/api/v1/auth', createAuthRouter());

  // OAuth redirect callbacks (outside authMiddleware; never echoes tokens)
  app.route('/api/v1/integrations', createIntegrationsCallbackRouter());

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        },
        err.status as 400 | 401 | 403 | 404 | 409 | 429 | 500,
      );
    }

    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      },
      500,
    );
  });

  app.get('/api/v1/health', async (c) => {
    const parsedEnv = envSchema.safeParse({
      ENVIRONMENT: c.env.ENVIRONMENT,
      AI_INSIGHTS_ENABLED: c.env.AI_INSIGHTS_ENABLED,
      ACCESS_TEAM_DOMAIN: c.env.ACCESS_TEAM_DOMAIN,
      ACCESS_AUD: c.env.ACCESS_AUD,
      DISCORD_WEBHOOK_URL: c.env.DISCORD_WEBHOOK_URL,
      GEMINI_API_KEY: c.env.GEMINI_API_KEY,
    });

    const authMode =
      c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD ? 'access' : 'session';
    const sessionConfigured =
      Boolean(c.env.SESSION_SECRET) || (c.env.ENVIRONMENT ?? 'local') === 'local';
    const authConfigured = authMode === 'access' || sessionConfigured;

    let status: HealthStatus = 'ok';
    let lastIngestAt: string | null = null;
    try {
      await c.env.DB.prepare('SELECT 1 AS ok').first();
      const ingestRow = await c.env.DB.prepare(
        'SELECT MAX(first_seen_at) AS last_ingest_at FROM items',
      ).first<{ last_ingest_at: string | null }>();
      lastIngestAt = ingestRow?.last_ingest_at ?? null;
    } catch {
      status = 'degraded';
    }

    if (
      !authConfigured ||
      (authMode === 'access' && !parsedEnv.success)
    ) {
      status = 'degraded';
    }

    const providers = {
      youtube: c.env.YOUTUBE_API_KEY
        ? { status: 'api_key_active', label: 'YouTube API' }
        : { status: 'public_feed_active', label: 'YouTube RSS' },
      twitch:
        c.env.TWITCH_CLIENT_ID && c.env.TWITCH_CLIENT_SECRET
          ? { status: 'ready', label: 'Twitch Helix' }
          : { status: 'credentials_missing', label: 'Twitch Needs API Keys' },
      kick:
        c.env.KICK_CLIENT_ID && c.env.KICK_CLIENT_SECRET
          ? { status: 'ready', label: 'Kick API' }
          : { status: 'credentials_missing', label: 'Kick Needs API Keys' },
    };

    return c.json({
      status,
      authMode,
      environment: c.env.ENVIRONMENT ?? 'local',
      authConfigured,
      source: 'edge',
      providers,
      lastIngestAt,
      checkedAt: new Date().toISOString(),
    });
  });

  app.use('/api/v1/me', authMiddleware);
  app.use('/api/v1/workspaces/*', authMiddleware);
  app.use('/api/v1/providers/*', authMiddleware);

  app.use('/api/v1/sources', authMiddleware);
  app.use('/api/v1/sources/*', authMiddleware);
  app.use('/api/v1/feed', authMiddleware);
  app.use('/api/v1/feed/*', authMiddleware);
  app.use('/api/v1/saved-views', authMiddleware);
  app.use('/api/v1/saved-views/*', authMiddleware);
  app.use('/api/v1/mission-control', authMiddleware);
  app.use('/api/v1/live', authMiddleware);
  app.use('/api/v1/rising', authMiddleware);
  app.use('/api/v1/claims', authMiddleware);
  app.use('/api/v1/claims/*', authMiddleware);
  app.use('/api/v1/alerts', authMiddleware);
  app.use('/api/v1/alerts/*', authMiddleware);
  app.use('/api/v1/notifications', authMiddleware);
  app.use('/api/v1/notifications/*', authMiddleware);
  app.use('/api/v1/clips', authMiddleware);
  app.use('/api/v1/clips/*', authMiddleware);
  app.use('/api/v1/creators', authMiddleware);
  app.use('/api/v1/creators/*', authMiddleware);
  app.use('/api/v1/roi', authMiddleware);
  app.use('/api/v1/admin/*', authMiddleware);
  app.use('/api/v1/reports/*', authMiddleware);
  app.use('/api/v1/settings/*', authMiddleware);
  app.use('/api/v1/export', authMiddleware);
  app.use('/api/v1/ws', authMiddleware);

  app.route('/api/v1/sources', createSourcesRouter());
  app.route('/api/v1/providers', createProvidersRouter());
  app.route('/api/v1/feed', createFeedRouter());
  app.route('/api/v1/saved-views', createSavedViewsRouter());
  app.route('/api/v1/mission-control', createMissionControlRouter());
  app.route('/api/v1/live', createLiveRouter());
  app.route('/api/v1/rising', createRisingRouter());
  app.route('/api/v1/claims', createClaimsRouter());
  app.route('/api/v1/alerts', createAlertsRouter());
  app.route('/api/v1/notifications', createNotificationsRouter());
  app.route('/api/v1/clips', createClipsRouter());
  app.route('/api/v1/creators', createCreatorsRouter());
  app.route('/api/v1/admin/integrations', createAdminIntegrationsRouter());
  app.route('/api/v1/admin', createAdminRouter());
  app.route('/api/v1', createReportsRouter());
  app.route('/api/v1', createSettingsRouter());

  app.get('/api/v1/ws', async (c) => {
    const principal = c.get('principal');
    const stub = c.env.WORKSPACE_DO.get(
      c.env.WORKSPACE_DO.idFromName(principal.workspaceId),
    );
    return stub.fetch(c.req.raw);
  });

  app.get('/api/v1/me', (c) => {
    const principal = c.get('principal');
    return c.json({
      userId: principal.userId,
      email: principal.email,
      workspaceId: principal.workspaceId,
      role: principal.role,
    });
  });

  app.post('/api/v1/workspaces/ping', (c) => {
    const principal = c.get('principal');
    return c.json({
      ok: true,
      workspaceId: principal.workspaceId,
    });
  });

  app.get('/api/v1/workspaces/:workspaceId/check', (c) => {
    const principal = c.get('principal');
    const requestedId = c.req.param('workspaceId');
    if (requestedId !== principal.workspaceId) {
      throw AppError.forbidden('Cross-tenant workspace access denied');
    }
    return c.json({
      ok: true,
      workspaceId: principal.workspaceId,
    });
  });

  return app;
}

function getAuthRequestContext(
  env: EdgeBindings,
  request: Request,
  deps: AppDependencies,
): { provider: AuthProvider; token: string | undefined } {
  if (deps.authProviderFactory) {
    return {
      provider: deps.authProviderFactory(env),
      token: request.headers.get('Cf-Access-Jwt-Assertion') ?? undefined,
    };
  }
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    return {
      provider: new CloudflareAccessAuthProvider(
        env.ACCESS_TEAM_DOMAIN,
        env.ACCESS_AUD,
      ),
      token: request.headers.get('Cf-Access-Jwt-Assertion') ?? undefined,
    };
  }
  const secret = resolveSessionSecret(env.SESSION_SECRET, env.ENVIRONMENT);
  const cookieName = getSessionCookieName(request.url);
  return {
    provider: new SessionAuthProvider(secret),
    token: parseCookie(request.headers.get('Cookie') ?? undefined, cookieName),
  };
}
