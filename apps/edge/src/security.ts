import type { MiddlewareHandler } from 'hono';
import { AppError } from '@clipse/core';

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' https:",
    "connect-src 'self' wss:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Robots-Tag': 'noindex',
};

export const securityHeadersMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(header, value);
  }
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfMiddleware: MiddlewareHandler = async (c, next) => {
  if (!MUTATING_METHODS.has(c.req.method.toUpperCase())) {
    await next();
    return;
  }

  const secFetchSite = c.req.header('Sec-Fetch-Site');
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    throw AppError.forbidden('CSRF check failed: untrusted Sec-Fetch-Site');
  }

  const origin = c.req.header('Origin');
  const requestOrigin = new URL(c.req.url).origin;

  if (origin) {
    if (origin !== requestOrigin) {
      throw AppError.forbidden('CSRF check failed: Origin mismatch');
    }
    await next();
    return;
  }

  if (secFetchSite === 'same-origin' || secFetchSite === 'none') {
    await next();
    return;
  }

  throw AppError.forbidden('CSRF check failed: missing Origin or Sec-Fetch-Site');
};
