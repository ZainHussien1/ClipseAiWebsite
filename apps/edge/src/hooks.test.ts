import { describe, expect, it } from 'vitest';
import type { IngestQueueMessage } from '@clipse/core';
import { createApp, type EdgeBindings } from './app.js';
import type { WorkspaceDO } from './do/workspace.js';

function createDedupeMockDb(): {
  db: D1Database;
  revokedAccounts: string[];
} {
  const dedupe = new Map<string, string>();
  const revokedAccounts: string[] = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM webhook_dedupe')) {
                const key = `${String(args[0])}:${String(args[1])}`;
                return dedupe.has(key) ? ({ ok: 1 } as T) : null;
              }
              return null;
            },
            async run() {
              if (sql.includes('DELETE FROM webhook_dedupe')) {
                const key = `${String(args[0])}:${String(args[1])}`;
                const nowIso = String(args[2]);
                const exp = dedupe.get(key);
                if (exp && exp <= nowIso) {
                  dedupe.delete(key);
                }
              } else if (sql.includes('INSERT INTO webhook_dedupe')) {
                const key = `${String(args[0])}:${String(args[1])}`;
                dedupe.set(key, String(args[2]));
              } else if (sql.includes('UPDATE webhook_subscriptions')) {
                revokedAccounts.push(String(args[1]));
              }
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, revokedAccounts };
}

function createMockQueue(): {
  queue: Queue<IngestQueueMessage>;
  sent: IngestQueueMessage[];
} {
  const sent: IngestQueueMessage[] = [];
  const queue = {
    async send(msg: IngestQueueMessage) {
      sent.push(msg);
    },
    async sendBatch(batch: Iterable<MessageSendRequest<IngestQueueMessage>>) {
      for (const item of batch) {
        sent.push(item.body);
      }
    },
  } as unknown as Queue<IngestQueueMessage>;
  return { queue, sent };
}

async function signHmacHex(
  algo: 'SHA-1' | 'SHA-256',
  secret: string,
  text: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algo },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return Array.from(sig)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toPem(spki: ArrayBuffer): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
}

function makeEnv(
  db: D1Database,
  queue: Queue<IngestQueueMessage>,
  overrides: Partial<EdgeBindings> = {},
): EdgeBindings {
  return {
    DB: db,
    WORKSPACE_DO: {} as DurableObjectNamespace<WorkspaceDO>,
    INGEST_QUEUE: queue,
    ENVIRONMENT: 'local',
    YOUTUBE_WEBSUB_SECRET: 'yt-secret-123',
    TWITCH_EVENTSUB_SECRET: 'tw-secret-456',
    ...overrides,
  };
}

describe('edge /hooks/* webhook security and enqueueing', () => {
  it('handles YouTube WebSub challenge, valid HMAC, replay dedupe, and 64KB cap', async () => {
    const app = createApp();
    const { db } = createDedupeMockDb();
    const { queue, sent } = createMockQueue();
    const env = makeEnv(db, queue);

    const challengeRes = await app.request(
      'https://radar.test/hooks/youtube?hub.mode=subscribe&hub.challenge=abc123&hub.topic=https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC123',
      { method: 'GET' },
      env,
    );
    expect(challengeRes.status).toBe(200);
    expect(await challengeRes.text()).toBe('abc123');

    const atom = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <yt:videoId>vid001</yt:videoId>
        <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
        <title>New Video</title>
        <link rel="alternate" href="https://www.youtube.com/watch?v=vid001"/>
        <published>2026-11-26T10:00:00Z</published>
        <updated>2026-11-26T10:00:00Z</updated>
      </entry>
    </feed>`;

    const forged = await app.request(
      'https://radar.test/hooks/youtube',
      {
        method: 'POST',
        headers: { 'X-Hub-Signature': 'sha256=deadbeef' },
        body: atom,
      },
      env,
    );
    expect(forged.status).toBe(403);

    const sig = await signHmacHex('SHA-256', 'yt-secret-123', atom);
    const valid = await app.request(
      'https://radar.test/hooks/youtube',
      {
        method: 'POST',
        headers: { 'X-Hub-Signature': `sha256=${sig}` },
        body: atom,
      },
      env,
    );
    expect(valid.status).toBe(200);
    expect(sent).toHaveLength(1);

    // Replay should be deduped and not enqueue a second message
    const replay = await app.request(
      'https://radar.test/hooks/youtube',
      {
        method: 'POST',
        headers: { 'X-Hub-Signature': `sha256=${sig}` },
        body: atom,
      },
      env,
    );
    expect(replay.status).toBe(200);
    expect(sent).toHaveLength(1);

    // Oversize > 64KB
    const oversized = 'x'.repeat(65 * 1024);
    const tooLarge = await app.request(
      'https://radar.test/hooks/youtube',
      { method: 'POST', body: oversized },
      env,
    );
    expect(tooLarge.status).toBe(413);
  });

  it('handles Twitch EventSub verification, stale timestamp, replay, revocation, and notification', async () => {
    const app = createApp();
    const { db, revokedAccounts } = createDedupeMockDb();
    const { queue, sent } = createMockQueue();
    const env = makeEnv(db, queue);

    const nowIso = new Date().toISOString();
    const verifyBody = JSON.stringify({
      challenge: 'tw-challenge-xyz',
      subscription: {
        id: 'sub-1',
        type: 'stream.online',
        condition: { broadcaster_user_id: '1001' },
      },
    });
    const verifySig = await signHmacHex('SHA-256', 'tw-secret-456', `msg-1${nowIso}${verifyBody}`);

    const verifyRes = await app.request(
      'https://radar.test/hooks/twitch',
      {
        method: 'POST',
        headers: {
          'Twitch-Eventsub-Message-Id': 'msg-1',
          'Twitch-Eventsub-Message-Timestamp': nowIso,
          'Twitch-Eventsub-Message-Signature': `sha256=${verifySig}`,
          'Twitch-Eventsub-Message-Type': 'webhook_callback_verification',
        },
        body: verifyBody,
      },
      env,
    );
    expect(verifyRes.status).toBe(200);
    expect(await verifyRes.text()).toBe('tw-challenge-xyz');

    // Stale timestamp (> 10 min)
    const staleIso = new Date(Date.now() - 15 * 60_000).toISOString();
    const staleRes = await app.request(
      'https://radar.test/hooks/twitch',
      {
        method: 'POST',
        headers: {
          'Twitch-Eventsub-Message-Id': 'msg-stale',
          'Twitch-Eventsub-Message-Timestamp': staleIso,
          'Twitch-Eventsub-Message-Signature': 'sha256=deadbeef',
          'Twitch-Eventsub-Message-Type': 'notification',
        },
        body: '{}',
      },
      env,
    );
    expect(staleRes.status).toBe(403);

    // Valid notification + replay
    const notifBody = JSON.stringify({
      subscription: {
        id: 'sub-1',
        type: 'stream.online',
        condition: { broadcaster_user_id: '1001' },
      },
      event: {
        id: 'stream-99',
        broadcaster_user_id: '1001',
        broadcaster_user_login: 'shroud',
        broadcaster_user_name: 'Shroud',
        started_at: nowIso,
      },
    });
    const notifSig = await signHmacHex('SHA-256', 'tw-secret-456', `msg-2${nowIso}${notifBody}`);
    const notifHeaders = {
      'Twitch-Eventsub-Message-Id': 'msg-2',
      'Twitch-Eventsub-Message-Timestamp': nowIso,
      'Twitch-Eventsub-Message-Signature': `sha256=${notifSig}`,
      'Twitch-Eventsub-Message-Type': 'notification',
    };

    const notifRes = await app.request(
      'https://radar.test/hooks/twitch',
      { method: 'POST', headers: notifHeaders, body: notifBody },
      env,
    );
    expect(notifRes.status).toBe(204);
    expect(sent).toHaveLength(1);

    const replayRes = await app.request(
      'https://radar.test/hooks/twitch',
      { method: 'POST', headers: notifHeaders, body: notifBody },
      env,
    );
    expect(replayRes.status).toBe(200);
    expect(sent).toHaveLength(1);

    // Revocation
    const revSig = await signHmacHex('SHA-256', 'tw-secret-456', `msg-3${nowIso}${verifyBody}`);
    const revRes = await app.request(
      'https://radar.test/hooks/twitch',
      {
        method: 'POST',
        headers: {
          'Twitch-Eventsub-Message-Id': 'msg-3',
          'Twitch-Eventsub-Message-Timestamp': nowIso,
          'Twitch-Eventsub-Message-Signature': `sha256=${revSig}`,
          'Twitch-Eventsub-Message-Type': 'revocation',
        },
        body: verifyBody,
      },
      env,
    );
    expect(revRes.status).toBe(204);
    expect(revokedAccounts).toEqual(['1001']);
  });

  it('verifies Kick Ed25519 signature, rejects forgery, and dedupes', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const spki = (await crypto.subtle.exportKey('spki', kp.publicKey)) as ArrayBuffer;
    const pem = toPem(spki);

    const app = createApp();
    const { db } = createDedupeMockDb();
    const { queue, sent } = createMockQueue();
    const env = makeEnv(db, queue, { KICK_PUBLIC_KEY: pem });

    const nowIso = new Date().toISOString();
    const body = JSON.stringify({
      broadcaster: { user_id: 777, username: 'streamer777', channel_slug: 'streamer777' },
      is_live: true,
      title: 'Kick Live!',
      viewer_count: 1500,
      started_at: nowIso,
    });
    const signed = new TextEncoder().encode(`kk-1.${nowIso}.${body}`);
    const sigBuf = new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, signed));
    const sigB64 = btoa(String.fromCharCode(...sigBuf));

    const forged = await app.request(
      'https://radar.test/hooks/kick',
      {
        method: 'POST',
        headers: {
          'Kick-Event-Message-Id': 'kk-1',
          'Kick-Event-Message-Timestamp': nowIso,
          'Kick-Event-Signature': btoa('invalid-sig'),
        },
        body,
      },
      env,
    );
    expect(forged.status).toBe(403);

    const valid = await app.request(
      'https://radar.test/hooks/kick',
      {
        method: 'POST',
        headers: {
          'Kick-Event-Message-Id': 'kk-1',
          'Kick-Event-Message-Timestamp': nowIso,
          'Kick-Event-Signature': sigB64,
        },
        body,
      },
      env,
    );
    expect(valid.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe('record_live_sample');
  });
});
