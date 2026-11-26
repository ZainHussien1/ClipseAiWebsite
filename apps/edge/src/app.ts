import { Hono, type MiddlewareHandler } from 'hono';
import {
  AppError,
  parseEnv,
  type AuthProvider,
  type HealthStatus,
  type IngestQueueMessage,
  type Principal,
} from '@clipse/core';
import { CloudflareAccessAuthProvider, resolvePrincipal } from './auth.js';
import {
  createKickHooksRouter,
  createTwitchHooksRouter,
  createYouTubeHooksRouter,
} from './hooks/index.js';
import { createAlertsRouter } from './routes/alerts.js';
import { createClaimsRouter } from './routes/claims.js';
import { createClipsRouter } from './routes/clips.js';
import { createFeedRouter } from './routes/feed.js';
import { createLiveRouter } from './routes/live.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createReportsRouter } from './routes/reports.js';
import { createRisingRouter } from './routes/rising.js';
import { createSettingsRouter } from './routes/settings.js';
import { createSourcesRouter } from './routes/sources.js';
import { csrfMiddleware, securityHeadersMiddleware } from './security.js';
import type { WorkspaceDO } from './do/workspace.js';

export interface EdgeBindings {
  DB: D1Database;
  WORKSPACE_DO: DurableObjectNamespace<WorkspaceDO>;
  INGEST_QUEUE?: Queue<IngestQueueMessage>;
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
  AI_INSIGHTS_ENABLED?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DISCORD_WEBHOOK_URL?: string;
  GEMINI_API_KEY?: string;
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
  app.use('/api/*', csrfMiddleware);

  // Public provider webhook endpoints (outside Access JWT & CSRF; signature + dedupe protected)
  app.route('/hooks/youtube', createYouTubeHooksRouter());
  app.route('/hooks/twitch', createTwitchHooksRouter());
  app.route('/hooks/kick', createKickHooksRouter());

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
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
    const env = parseEnv({
      ENVIRONMENT: c.env.ENVIRONMENT,
      AI_INSIGHTS_ENABLED: c.env.AI_INSIGHTS_ENABLED,
      ACCESS_TEAM_DOMAIN: c.env.ACCESS_TEAM_DOMAIN,
      ACCESS_AUD: c.env.ACCESS_AUD,
      DISCORD_WEBHOOK_URL: c.env.DISCORD_WEBHOOK_URL,
      GEMINI_API_KEY: c.env.GEMINI_API_KEY,
    });

    let status: HealthStatus = 'ok';
    try {
      await c.env.DB.prepare('SELECT 1 AS ok').first();
    } catch {
      status = 'degraded';
    }

    return c.json({
      status,
      environment: env.ENVIRONMENT,
      source: 'edge',
      checkedAt: new Date().toISOString(),
    });
  });

  app.use('/api/v1/me', async (c, next) => {
    const authProvider = getAuthProvider(c.env, deps);
    const principal = await resolvePrincipal(
      c.env.DB,
      authProvider,
      c.req.header('Cf-Access-Jwt-Assertion'),
    );
    c.set('principal', principal);
    await next();
  });

  app.use('/api/v1/workspaces/*', async (c, next) => {
    const authProvider = getAuthProvider(c.env, deps);
    const principal = await resolvePrincipal(
      c.env.DB,
      authProvider,
      c.req.header('Cf-Access-Jwt-Assertion'),
    );
    c.set('principal', principal);
    await next();
  });

  const authMiddleware: MiddlewareHandler<{
    Bindings: EdgeBindings;
    Variables: EdgeVariables;
  }> = async (c, next) => {
    const authProvider = getAuthProvider(c.env, deps);
    const principal = await resolvePrincipal(
      c.env.DB,
      authProvider,
      c.req.header('Cf-Access-Jwt-Assertion'),
    );
    c.set('principal', principal);
    await next();
  };

  app.use('/api/v1/sources', authMiddleware);
  app.use('/api/v1/sources/*', authMiddleware);
  app.use('/api/v1/feed', authMiddleware);
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
  app.use('/api/v1/roi', authMiddleware);
  app.use('/api/v1/admin/*', authMiddleware);
  app.use('/api/v1/reports/*', authMiddleware);
  app.use('/api/v1/settings/*', authMiddleware);
  app.use('/api/v1/export', authMiddleware);
  app.use('/api/v1/ws', authMiddleware);

  app.route('/api/v1/sources', createSourcesRouter());
  app.route('/api/v1/feed', createFeedRouter());
  app.route('/api/v1/live', createLiveRouter());
  app.route('/api/v1/rising', createRisingRouter());
  app.route('/api/v1/claims', createClaimsRouter());
  app.route('/api/v1/alerts', createAlertsRouter());
  app.route('/api/v1/notifications', createNotificationsRouter());
  app.route('/api/v1/clips', createClipsRouter());
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

function getAuthProvider(env: EdgeBindings, deps: AppDependencies): AuthProvider {
  if (deps.authProviderFactory) {
    return deps.authProviderFactory(env);
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    throw AppError.unauthorized('Access JWT verifier is not configured');
  }
  return new CloudflareAccessAuthProvider(env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
}
