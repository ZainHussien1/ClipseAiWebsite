import { Hono } from 'hono';
import { z } from 'zod';
import type { IngestQueueMessage } from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import {
  checkAndRecordDedupe,
  isTimestampWithinWindow,
  PayloadTooLargeError,
  readBoundedBody,
  verifyEd25519Base64,
} from './crypto.js';

const kickWebhookSchema = z.object({
  broadcaster: z.object({
    user_id: z.union([z.number().int(), z.string().min(1)]),
    username: z.string().min(1),
    channel_slug: z.string().min(1),
  }),
  is_live: z.boolean(),
  title: z.string().optional(),
  viewer_count: z.number().int().nonnegative().optional(),
  started_at: z.string().nullable().optional(),
});

const KICK_PUBLIC_KEY_URL = 'https://api.kick.com/public/v1/public-key';
const KEY_CACHE_TTL_MS = 60 * 60 * 1000;
let cachedKickKey: { pem: string; expiresAtMs: number } | null = null;

async function resolveKickPublicKey(
  configuredKey: string | undefined,
  nowMs: number,
): Promise<string | null> {
  if (configuredKey && configuredKey.trim().length > 0) {
    return configuredKey;
  }
  if (cachedKickKey && cachedKickKey.expiresAtMs > nowMs) {
    return cachedKickKey.pem;
  }
  try {
    const res = await fetch(KICK_PUBLIC_KEY_URL, {
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      data?: { public_key?: unknown };
    } | null;
    const pem =
      typeof json?.data?.public_key === 'string' ? json.data.public_key : null;
    if (!pem) return null;
    cachedKickKey = { pem, expiresAtMs: nowMs + KEY_CACHE_TTL_MS };
    return pem;
  } catch {
    return null;
  }
}

export function createKickHooksRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.post('/', async (c) => {
    const nowMs = Date.now();
    const publicKey = await resolveKickPublicKey(c.env.KICK_PUBLIC_KEY, nowMs);
    if (!publicKey) {
      return c.text('Kick public key unavailable', 503);
    }

    const messageId = c.req.header('Kick-Event-Message-Id') ?? '';
    const timestamp = c.req.header('Kick-Event-Message-Timestamp') ?? '';
    const signature = c.req.header('Kick-Event-Signature') ?? '';

    if (!messageId || !timestamp || !signature) {
      return c.text('Missing Kick webhook headers', 400);
    }
    if (!isTimestampWithinWindow(timestamp, nowMs)) {
      return c.text('Stale Kick webhook timestamp', 403);
    }

    let bodyBytes: Uint8Array;
    try {
      bodyBytes = await readBoundedBody(c.req.raw);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        return c.text(err.message, 413);
      }
      return c.text('Invalid body', 400);
    }

    const bodyText = new TextDecoder().decode(bodyBytes);
    const signedPayload = new TextEncoder().encode(`${messageId}.${timestamp}.${bodyText}`);
    if (!(await verifyEd25519Base64(publicKey, signedPayload, signature))) {
      return c.text('Invalid signature', 403);
    }

    const isFresh = await checkAndRecordDedupe(c.env.DB, 'kick', messageId, nowMs);
    if (!isFresh) {
      return c.text('Duplicate', 200);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(bodyText);
    } catch {
      return c.text('Invalid JSON', 400);
    }

    const parsed = kickWebhookSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return c.text('Invalid Kick webhook payload', 400);
    }

    if (c.env.INGEST_QUEUE) {
      const data = parsed.data;
      const broadcasterId = String(data.broadcaster.user_id);
      const receivedAt = new Date(nowMs).toISOString();
      const msg: IngestQueueMessage = {
        type: 'record_live_sample',
        idempotencyKey: `kk:${messageId}`,
        source: 'webhook',
        receivedAt,
        account: {
          platform: 'kick',
          externalId: broadcasterId,
          handle: data.broadcaster.channel_slug,
          displayName: data.broadcaster.username,
        },
        sample: {
          platform: 'kick',
          streamExternalId: `kick-live-${broadcasterId}-${data.started_at ?? 'active'}`,
          accountExternalId: broadcasterId,
          title: data.title,
          sampledAt: receivedAt,
          viewers: data.viewer_count ?? 0,
          isLive: data.is_live,
        },
      };
      await c.env.INGEST_QUEUE.send(msg);
    }

    return c.body(null, 200);
  });

  return router;
}
