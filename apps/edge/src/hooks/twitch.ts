import { Hono } from 'hono';
import { z } from 'zod';
import type { IngestQueueMessage } from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import {
  checkAndRecordDedupe,
  isTimestampWithinWindow,
  PayloadTooLargeError,
  readBoundedBody,
  verifyHmacHex,
} from './crypto.js';

const twitchPayloadSchema = z.object({
  challenge: z.string().optional(),
  subscription: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    status: z.string().optional(),
    condition: z.object({
      broadcaster_user_id: z.string().min(1).optional(),
    }),
  }),
  event: z
    .object({
      id: z.string().optional(),
      broadcaster_user_id: z.string().min(1),
      broadcaster_user_login: z.string().optional(),
      broadcaster_user_name: z.string().optional(),
      started_at: z.string().optional(),
    })
    .optional(),
});

export function createTwitchHooksRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.post('/', async (c) => {
    const secret = c.env.TWITCH_EVENTSUB_SECRET;
    if (!secret) {
      return c.text('Twitch EventSub secret not configured', 503);
    }

    const messageId = c.req.header('Twitch-Eventsub-Message-Id') ?? '';
    const timestamp = c.req.header('Twitch-Eventsub-Message-Timestamp') ?? '';
    const signature = c.req.header('Twitch-Eventsub-Message-Signature') ?? '';
    const messageType = c.req.header('Twitch-Eventsub-Message-Type') ?? '';

    if (!messageId || !timestamp || !signature || !messageType) {
      return c.text('Missing EventSub headers', 400);
    }

    const nowMs = Date.now();
    if (!isTimestampWithinWindow(timestamp, nowMs)) {
      return c.text('Stale EventSub timestamp', 403);
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
    const hmacInput = new TextEncoder().encode(messageId + timestamp + bodyText);
    const [prefix, hex] = signature.split('=', 2);
    if (prefix !== 'sha256' || !hex || !(await verifyHmacHex('SHA-256', secret, hmacInput, hex))) {
      return c.text('Invalid signature', 403);
    }

    const isFresh = await checkAndRecordDedupe(c.env.DB, 'twitch', messageId, nowMs);
    if (!isFresh) {
      return c.text('Duplicate', 200);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(bodyText);
    } catch {
      return c.text('Invalid JSON', 400);
    }

    const payload = twitchPayloadSchema.safeParse(parsedJson);
    if (!payload.success) {
      return c.text('Invalid EventSub payload', 400);
    }

    if (messageType === 'webhook_callback_verification' && payload.data.challenge) {
      return c.text(payload.data.challenge, 200);
    }

    if (messageType === 'revocation') {
      const accountId = payload.data.subscription.condition.broadcaster_user_id;
      if (accountId) {
        await c.env.DB.prepare(
          `UPDATE webhook_subscriptions SET status = 'revoked', updated_at = ? WHERE platform = 'twitch' AND account_external_id = ?`,
        )
          .bind(new Date(nowMs).toISOString(), accountId)
          .run();
      }
      return c.body(null, 204);
    }

    if (messageType === 'notification' && payload.data.event && c.env.INGEST_QUEUE) {
      const ev = payload.data.event;
      const isOnline = payload.data.subscription.type === 'stream.online';
      const receivedAt = new Date(nowMs).toISOString();
      const msg: IngestQueueMessage = {
        type: 'record_live_sample',
        idempotencyKey: `tw:${messageId}`,
        source: 'webhook',
        receivedAt,
        account: ev.broadcaster_user_login
          ? {
              platform: 'twitch',
              externalId: ev.broadcaster_user_id,
              handle: ev.broadcaster_user_login,
              displayName: ev.broadcaster_user_name ?? ev.broadcaster_user_login,
            }
          : undefined,
        sample: {
          platform: 'twitch',
          streamExternalId: ev.id ?? `tw-live-${ev.broadcaster_user_id}`,
          accountExternalId: ev.broadcaster_user_id,
          sampledAt: ev.started_at ?? receivedAt,
          viewers: 0,
          isLive: isOnline,
        },
      };
      await c.env.INGEST_QUEUE.send(msg);
    }

    return c.body(null, 204);
  });

  return router;
}
