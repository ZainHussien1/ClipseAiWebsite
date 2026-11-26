import { AppError, asUserId, type AuthProvider, type VerifiedIdentity } from '@clipse/core';
import { z } from 'zod';

const sessionPayloadSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  exp: z.number().int().positive(),
});

const DEFAULT_SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function resolveSessionSecret(
  secret: string | undefined,
  environment: string | undefined,
): string {
  if (secret && secret.trim().length >= 16) {
    return secret;
  }
  if ((environment ?? 'local') === 'local') {
    return 'local-dev-ephemeral-session-secret';
  }
  throw AppError.internal('SESSION_SECRET is not configured');
}

export function getSessionCookieName(requestUrl: string): string {
  try {
    return new URL(requestUrl).protocol === 'https:'
      ? '__Host-clipse_session'
      : 'clipse_session';
  } catch {
    return '__Host-clipse_session';
  }
}

export function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

export async function signSessionToken(
  identity: { sub: string; email: string },
  secret: string,
  ttlSeconds = DEFAULT_SESSION_TTL_SEC,
): Promise<string> {
  const payload = {
    sub: identity.sub,
    email: identity.email,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encodedPayload = toBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${toBase64Url(new Uint8Array(sig))}`;
}

export class SessionAuthProvider implements AuthProvider {
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw AppError.unauthorized('Missing session cookie');
    }

    const parts = trimmed.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw AppError.unauthorized('Malformed session token');
    }

    const [encodedPayload, encodedSig] = parts;
    let validSig = false;
    try {
      const key = await importHmacKey(this.secret);
      const sigBytes = fromBase64Url(encodedSig);
      validSig = await crypto.subtle.verify(
        'HMAC',
        key,
        sigBytes,
        new TextEncoder().encode(encodedPayload),
      );
    } catch {
      throw AppError.unauthorized('Invalid session signature');
    }

    if (!validSig) {
      throw AppError.unauthorized('Invalid session signature');
    }

    let decodedJson: unknown;
    try {
      const raw = new TextDecoder().decode(fromBase64Url(encodedPayload));
      decodedJson = JSON.parse(raw);
    } catch {
      throw AppError.unauthorized('Invalid session payload');
    }

    const parsed = sessionPayloadSchema.safeParse(decodedJson);
    if (!parsed.success) {
      throw AppError.unauthorized('Invalid session claims');
    }

    if (parsed.data.exp <= Math.floor(Date.now() / 1000)) {
      throw AppError.unauthorized('Session expired');
    }

    return {
      userId: asUserId(parsed.data.sub),
      email: parsed.data.email,
    };
  }
}
