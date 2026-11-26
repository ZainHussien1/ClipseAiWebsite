import { Hono } from 'hono';
import { AppError } from '@clipse/core';
import { z } from 'zod';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { CloudflareAccessAuthProvider } from '../auth.js';
import {
  getSessionCookieName,
  parseCookie,
  resolveSessionSecret,
  SessionAuthProvider,
  signSessionToken,
} from '../session.js';

const bootstrapSchema = z.object({
  email: z.string().trim().email().max(254),
  workspaceName: z.string().trim().min(1).max(80).optional(),
});

function buildSetCookieHeader(
  requestUrl: string,
  token: string,
  maxAgeSeconds: number,
): string {
  const isHttps = (() => {
    try {
      return new URL(requestUrl).protocol === 'https:';
    } catch {
      return true;
    }
  })();
  const name = getSessionCookieName(requestUrl);
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function createAuthRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/status', async (c) => {
    const isAccess = Boolean(c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD);
    const mode = isAccess ? 'access' : 'session';

    const wsCountRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM workspaces',
    ).first<{ cnt: number }>();
    const hasWorkspace = (wsCountRow?.cnt ?? 0) > 0;

    let authenticated = false;
    let email: string | null = null;

    if (isAccess && c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD) {
      const jwt = c.req.header('Cf-Access-Jwt-Assertion');
      if (jwt) {
        try {
          const provider = new CloudflareAccessAuthProvider(
            c.env.ACCESS_TEAM_DOMAIN,
            c.env.ACCESS_AUD,
          );
          const id = await provider.verifyToken(jwt);
          authenticated = true;
          email = id.email;
        } catch {
          authenticated = false;
        }
      }
    } else {
      const cookieName = getSessionCookieName(c.req.url);
      const token = parseCookie(c.req.header('Cookie'), cookieName);
      if (token) {
        try {
          const secret = resolveSessionSecret(c.env.SESSION_SECRET, c.env.ENVIRONMENT);
          const provider = new SessionAuthProvider(secret);
          const id = await provider.verifyToken(token);
          const membership = await c.env.DB.prepare(
            'SELECT workspace_id FROM memberships WHERE user_id = ? LIMIT 1',
          )
            .bind(id.userId)
            .first<{ workspace_id: string }>();
          if (membership) {
            authenticated = true;
            email = id.email;
          }
        } catch {
          authenticated = false;
        }
      }
    }

    return c.json({
      mode,
      authenticated,
      email,
      hasWorkspace,
    });
  });

  router.post('/bootstrap', async (c) => {
    const body = bootstrapSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid email or workspace name', body.error.flatten());
    }

    const email = body.data.email.toLowerCase();
    const secret = resolveSessionSecret(c.env.SESSION_SECRET, c.env.ENVIRONMENT);

    const wsCountRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM workspaces',
    ).first<{ cnt: number }>();
    const existingWorkspaces = wsCountRow?.cnt ?? 0;

    if (existingWorkspaces === 0) {
      const workspaceId = `ws-${crypto.randomUUID().slice(0, 8)}`;
      const userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
      const membershipId = `mem-${crypto.randomUUID().slice(0, 8)}`;
      const wsName = body.data.workspaceName ?? 'Clipse Workspace';
      const slug = `${wsName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'}-${workspaceId.slice(-4)}`;
      const now = new Date().toISOString();

      await c.env.DB.prepare(
        'INSERT INTO workspaces (id, slug, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(workspaceId, slug, wsName, 'UTC', now, now)
        .run();

      await c.env.DB.prepare(
        'INSERT INTO memberships (id, workspace_id, user_id, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(membershipId, workspaceId, userId, email, 'Owner', now, now)
        .run();

      const token = await signSessionToken({ sub: userId, email }, secret);
      c.header('Set-Cookie', buildSetCookieHeader(c.req.url, token, 60 * 60 * 24 * 7));

      return c.json(
        {
          authenticated: true,
          email,
          workspaceId,
          role: 'Owner',
        },
        201,
      );
    }

    const existingMember = await c.env.DB.prepare(
      'SELECT user_id, workspace_id, role FROM memberships WHERE LOWER(email) = ? LIMIT 1',
    )
      .bind(email)
      .first<{ user_id: string; workspace_id: string; role: string }>();

    if (!existingMember) {
      throw AppError.forbidden(
        'Workspace already initialized; ask an Owner/Admin to invite your email in Settings -> Members',
      );
    }

    const token = await signSessionToken(
      { sub: existingMember.user_id, email },
      secret,
    );
    c.header('Set-Cookie', buildSetCookieHeader(c.req.url, token, 60 * 60 * 24 * 7));

    return c.json({
      authenticated: true,
      email,
      workspaceId: existingMember.workspace_id,
      role: existingMember.role,
    });
  });

  router.post('/logout', (c) => {
    c.header('Set-Cookie', buildSetCookieHeader(c.req.url, '', 0));
    return c.json({ ok: true });
  });

  return router;
}
