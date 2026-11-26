import { AppError, type Platform } from '@clipse/core';

export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
export const WEBHOOK_TIMESTAMP_WINDOW_MS = 10 * 60 * 1000;
export const WEBHOOK_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

export class PayloadTooLargeError extends Error {
  constructor() {
    super('Webhook payload exceeds 64KB limit');
    this.name = 'PayloadTooLargeError';
  }
}

export async function readBoundedBody(
  request: Request,
  maxBytes = MAX_WEBHOOK_BODY_BYTES,
): Promise<Uint8Array> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new PayloadTooLargeError();
    }
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new PayloadTooLargeError();
  }
  return buf;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase();
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) {
    return null;
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function verifyHmacHex(
  algorithm: 'SHA-1' | 'SHA-256',
  secret: string,
  payload: Uint8Array,
  expectedHex: string,
): Promise<boolean> {
  const expectedBytes = hexToBytes(expectedHex);
  if (!expectedBytes || !secret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
  return timingSafeEqual(signature, expectedBytes);
}

function pemToDer(pem: string): Uint8Array | null {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!body) return null;
  try {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

export async function verifyEd25519Base64(
  publicKeyPem: string,
  message: Uint8Array,
  signatureBase64: string,
): Promise<boolean> {
  const spki = pemToDer(publicKeyPem);
  if (!spki) return false;
  let sigBytes: Uint8Array;
  try {
    const bin = atob(signatureBase64.trim());
    sigBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      sigBytes[i] = bin.charCodeAt(i);
    }
  } catch {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, sigBytes, message);
  } catch {
    return false;
  }
}

export function isTimestampWithinWindow(
  timestampIso: string,
  nowMs: number,
  windowMs = WEBHOOK_TIMESTAMP_WINDOW_MS,
): boolean {
  const parsedMs = Date.parse(timestampIso);
  if (!Number.isFinite(parsedMs)) return false;
  return Math.abs(nowMs - parsedMs) <= windowMs;
}

export async function checkAndRecordDedupe(
  db: D1Database,
  platform: Platform,
  messageId: string,
  nowMs: number,
  ttlMs = WEBHOOK_DEDUPE_TTL_MS,
): Promise<boolean> {
  if (!messageId) {
    throw AppError.badRequest('Missing webhook message ID');
  }
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  await db
    .prepare('DELETE FROM webhook_dedupe WHERE platform = ? AND message_id = ? AND expires_at <= ?')
    .bind(platform, messageId, nowIso)
    .run();

  const existing = await db
    .prepare('SELECT 1 AS ok FROM webhook_dedupe WHERE platform = ? AND message_id = ? LIMIT 1')
    .bind(platform, messageId)
    .first();

  if (existing) {
    return false;
  }

  await db
    .prepare('INSERT INTO webhook_dedupe (platform, message_id, expires_at) VALUES (?, ?, ?)')
    .bind(platform, messageId, expiresAt)
    .run();

  return true;
}
