import { Hono } from 'hono';
import {
  classifyShort,
  parseYouTubeWebSubAtom,
  type IngestQueueMessage,
} from '@clipse/core';
import type { EdgeBindings, EdgeVariables } from '../app.js';
import {
  checkAndRecordDedupe,
  PayloadTooLargeError,
  readBoundedBody,
  verifyHmacHex,
} from './crypto.js';

export function createYouTubeHooksRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/', (c) => {
    const mode = c.req.query('hub.mode');
    const challenge = c.req.query('hub.challenge');
    const topic = c.req.query('hub.topic');

    if ((mode !== 'subscribe' && mode !== 'unsubscribe') || !challenge || !topic) {
      return c.text('Invalid WebSub verification parameters', 400);
    }
    return c.text(challenge, 200);
  });

  router.post('/', async (c) => {
    const secret = c.env.YOUTUBE_WEBSUB_SECRET;
    if (!secret) {
      return c.text('YouTube WebSub secret not configured', 503);
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

    const sigHeader = c.req.header('X-Hub-Signature') ?? '';
    const [algoRaw, hex] = sigHeader.split('=', 2);
    const algo = algoRaw === 'sha256' ? 'SHA-256' : algoRaw === 'sha1' ? 'SHA-1' : null;
    if (!algo || !hex || !(await verifyHmacHex(algo, secret, bodyBytes, hex))) {
      return c.text('Invalid signature', 403);
    }

    const xml = new TextDecoder().decode(bodyBytes);
    const entries = parseYouTubeWebSubAtom(xml);
    const nowMs = Date.now();
    const receivedAt = new Date(nowMs).toISOString();
    const messages: Array<MessageSendRequest<IngestQueueMessage>> = [];

    for (const entry of entries) {
      const dedupeId = `${entry.videoId}:${entry.updatedAt}`;
      const isFresh = await checkAndRecordDedupe(c.env.DB, 'youtube', dedupeId, nowMs);
      if (!isFresh) continue;

      const shortCheck = classifyShort({ url: entry.url, title: entry.title });
      messages.push({
        body: {
          type: 'upsert_item',
          idempotencyKey: `yt:${dedupeId}`,
          source: 'webhook',
          receivedAt,
          item: {
            platform: 'youtube',
            externalId: entry.videoId,
            accountExternalId: entry.channelId,
            kind: shortCheck.isShort ? 'short' : 'video',
            title: entry.title,
            url: entry.url,
            publishedAt: entry.publishedAt,
            isEdit: entry.isEdit,
          },
        },
      });
    }

    if (messages.length > 0 && c.env.INGEST_QUEUE) {
      await c.env.INGEST_QUEUE.sendBatch(messages);
    }

    return c.text('OK', 200);
  });

  return router;
}
