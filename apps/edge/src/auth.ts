import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import {
  AppError,
  asUserId,
  asWorkspaceId,
  hasRoleAtLeast,
  roleSchema,
  type AuthProvider,
  type Principal,
  type VerifiedIdentity,
} from '@clipse/core';
import { z } from 'zod';

const accessPayloadSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
});

const jwksCache = new Map<string, JWTVerifyGetKey>();

function normalizeTeamOrigin(teamDomain: string): string {
  const trimmed = teamDomain.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function getAccessJwks(teamDomain: string): JWTVerifyGetKey {
  const origin = normalizeTeamOrigin(teamDomain);
  let cached = jwksCache.get(origin);
  if (!cached) {
    cached = createRemoteJWKSet(new URL(`${origin}/cdn-cgi/access/certs`));
    jwksCache.set(origin, cached);
  }
  return cached;
}

export class CloudflareAccessAuthProvider implements AuthProvider {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwks: JWTVerifyGetKey;

  constructor(
    teamDomain: string,
    audience: string,
    jwks?: JWTVerifyGetKey,
  ) {
    this.issuer = normalizeTeamOrigin(teamDomain);
    this.audience = audience;
    this.jwks = jwks ?? getAccessJwks(teamDomain);
  }

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    if (!token.trim()) {
      throw AppError.unauthorized('Missing Access JWT');
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
      });

      const parsed = accessPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw AppError.unauthorized('Invalid Access JWT claims');
      }

      return {
        userId: asUserId(parsed.data.sub),
        email: parsed.data.email,
      };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw AppError.unauthorized('Invalid or expired Access JWT');
    }
  }
}

export function requireWriterRole(principal: Principal): void {
  if (!hasRoleAtLeast(principal.role, 'Member')) {
    throw AppError.forbidden('Viewer role cannot perform write operations');
  }
}

export interface MembershipRow {
  workspace_id: string;
  role: string;
}

export async function resolvePrincipal(
  db: D1Database,
  authProvider: AuthProvider,
  jwtAssertion: string | undefined,
): Promise<Principal> {
  if (!jwtAssertion) {
    throw AppError.unauthorized('Missing Cf-Access-Jwt-Assertion header');
  }

  const identity = await authProvider.verifyToken(jwtAssertion);

  const row = await db
    .prepare(
      'SELECT workspace_id, role FROM memberships WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
    )
    .bind(identity.userId)
    .first<MembershipRow>();

  if (!row) {
    throw AppError.forbidden('No workspace membership for authenticated user');
  }

  const parsedRole = roleSchema.safeParse(row.role);
  if (!parsedRole.success) {
    throw AppError.internal('Invalid membership role in database');
  }

  return {
    userId: identity.userId,
    email: identity.email,
    workspaceId: asWorkspaceId(row.workspace_id),
    role: parsedRole.data,
  };
}
