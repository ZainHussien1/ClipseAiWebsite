import { Hono, type Handler } from 'hono';
import {
  AppError,
  loginSchema,
  MAX_TEAM_SEATS,
  requestCodeSchema,
  setPassphraseSchema,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import { CloudflareAccessAuthProvider } from '../auth.js';
import {
  getSessionCookieName,
  hashOtpCode,
  hashPassphrase,
  parseCookie,
  resolveSessionSecret,
  SessionAuthProvider,
  signSessionToken,
  verifyPassphrase,
} from '../session.js';

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

function generateSixDigitOtp(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  const num = (bytes[0] ?? 0) % 1_000_000;
  return String(num).padStart(6, '0');
}

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sendOtpToDiscord(
  webhookUrl: string | undefined,
  email: string,
  code: string,
): Promise<void> {
  if (!webhookUrl) return;
  try {
    const [localPart, domain] = email.split('@');
    const maskedLocal =
      localPart && localPart.length > 2
        ? `${localPart.slice(0, 2)}***`
        : '***';
    const maskedEmail = `${maskedLocal}@${domain ?? 'user'}`;
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `Clipse Radar sign-in code for ${maskedEmail}: **${code}** (expires in 10 min)`,
        allowed_mentions: { parse: [] },
      }),
    });
  } catch {
    // Best-effort delivery; never fail/enumerate on webhook error
  }
}

async function consumeValidOtp(
  db: D1Database,
  email: string,
  code: string,
  nowIso: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id, code_hash, attempts, expires_at
       FROM auth_otps
       WHERE email = ? AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(email)
    .first<{
      id: string;
      code_hash: string;
      attempts: number;
      expires_at: string;
    }>();

  if (!row) return false;
  if (row.attempts >= 5 || row.expires_at <= nowIso) {
    return false;
  }

  await db
    .prepare('UPDATE auth_otps SET attempts = attempts + 1 WHERE id = ?')
    .bind(row.id)
    .run();

  const candidateHash = await hashOtpCode(code);
  if (!constantTimeHexEqual(candidateHash, row.code_hash)) {
    return false;
  }

  await db
    .prepare('UPDATE auth_otps SET consumed_at = ? WHERE id = ?')
    .bind(nowIso, row.id)
    .run();
  return true;
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
      maxSeats: MAX_TEAM_SEATS,
    });
  });

  router.post('/request-code', async (c) => {
    const body = requestCodeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Invalid email address', body.error.flatten());
    }

    const email = body.data.email.toLowerCase();
    const wsCountRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM workspaces',
    ).first<{ cnt: number }>();
    const hasWorkspace = (wsCountRow?.cnt ?? 0) > 0;

    let isAllowlisted = !hasWorkspace;
    if (hasWorkspace) {
      const member = await c.env.DB.prepare(
        'SELECT user_id FROM memberships WHERE LOWER(email) = ? LIMIT 1',
      )
        .bind(email)
        .first<{ user_id: string }>();
      isAllowlisted = Boolean(member);
    }

    if (isAllowlisted) {
      const code = generateSixDigitOtp();
      const codeHash = await hashOtpCode(code);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
      await c.env.DB.prepare(
        `INSERT INTO auth_otps (id, email, code_hash, attempts, expires_at, created_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
      )
        .bind(crypto.randomUUID(), email, codeHash, expiresAt, now.toISOString())
        .run();

      await sendOtpToDiscord(c.env.DISCORD_WEBHOOK_URL, email, code);
    }

    return c.json({
      ok: true,
      message: 'If your email is allowlisted, a verification code has been sent.',
    });
  });

  const handleLoginOrBootstrap: Handler<{
    Bindings: EdgeBindings;
    Variables: EdgeVariables;
  }> = async (c) => {
    const body = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.unauthorized('Verification code or passphrase is required');
    }

    const email = body.data.email.toLowerCase();
    const secret = resolveSessionSecret(c.env.SESSION_SECRET, c.env.ENVIRONMENT);
    const nowIso = new Date().toISOString();

    const wsCountRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM workspaces',
    ).first<{ cnt: number }>();
    const existingWorkspaces = wsCountRow?.cnt ?? 0;

    if (existingWorkspaces === 0) {
      let passphraseHash: string | null = null;
      if (body.data.code) {
        const otpOk = await consumeValidOtp(c.env.DB, email, body.data.code, nowIso);
        if (!otpOk) {
          throw AppError.unauthorized('Invalid or expired verification code');
        }
      } else if (body.data.passphrase) {
        passphraseHash = await hashPassphrase(body.data.passphrase);
      }

      const workspaceId = `ws-${crypto.randomUUID().slice(0, 8)}`;
      const userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
      const membershipId = `mem-${crypto.randomUUID().slice(0, 8)}`;
      const wsName = body.data.workspaceName ?? 'Clipse Workspace';
      const slug = `${wsName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'}-${workspaceId.slice(-4)}`;

      await c.env.DB.prepare(
        'INSERT INTO workspaces (id, slug, name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(workspaceId, slug, wsName, 'UTC', nowIso, nowIso)
        .run();

      await c.env.DB.prepare(
        'INSERT INTO memberships (id, workspace_id, user_id, email, role, passphrase_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(membershipId, workspaceId, userId, email, 'Owner', passphraseHash, nowIso, nowIso)
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
      'SELECT user_id, workspace_id, role, passphrase_hash FROM memberships WHERE LOWER(email) = ? LIMIT 1',
    )
      .bind(email)
      .first<{
        user_id: string;
        workspace_id: string;
        role: string;
        passphrase_hash: string | null;
      }>();

    if (!existingMember) {
      throw AppError.unauthorized('Invalid email or verification credentials');
    }

    let verified = false;
    if (body.data.code) {
      verified = await consumeValidOtp(c.env.DB, email, body.data.code, nowIso);
    } else if (body.data.passphrase && existingMember.passphrase_hash) {
      verified = await verifyPassphrase(body.data.passphrase, existingMember.passphrase_hash);
    }

    if (!verified) {
      throw AppError.unauthorized('Invalid email or verification credentials');
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
  };

  router.post('/login', handleLoginOrBootstrap);
  router.post('/bootstrap', handleLoginOrBootstrap);

  router.post('/passphrase', async (c) => {
    const principal = c.get('principal');
    const body = setPassphraseSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw AppError.badRequest('Passphrase must be 8..128 characters', body.error.flatten());
    }

    const hash = await hashPassphrase(body.data.passphrase);
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE memberships SET passphrase_hash = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?',
    )
      .bind(hash, now, principal.workspaceId, principal.userId)
      .run();

    return c.json({ ok: true });
  });

  router.post('/logout', (c) => {
    c.header('Set-Cookie', buildSetCookieHeader(c.req.url, '', 0));
    return c.json({ ok: true });
  });

  return router;
}
