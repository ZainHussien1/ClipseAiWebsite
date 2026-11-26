import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  TokenBucketQuotaGovernor,
  YouTubeProvider,
  YouTubePublicProvider,
} from '@clipse/core';
import { processIngestBatch } from './ingest.js';
import { processNotifyBatch, processUnclaimedEscalations } from './notify.js';
import { reconcilePlatformAccounts } from './reconciler.js';
import { syncPlatformAccount, type SyncAccountInput, type SyncAccountResult } from './sync.js';

export interface EngineEnv {
  DB: D1Database;
  ENVIRONMENT: string;
  AI_INSIGHTS_ENABLED: string;
  WEBHOOK_ENCRYPTION_KEY?: string;
  DISCORD_WEBHOOK_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  YOUTUBE_API_KEY?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  KICK_CLIENT_ID?: string;
  KICK_CLIENT_SECRET?: string;
}

const quotaGovernor = new TokenBucketQuotaGovernor();

export class EngineEntrypoint extends WorkerEntrypoint<EngineEnv> {
  async ping(): Promise<{ ok: true; environment: string }> {
    return { ok: true, environment: this.env.ENVIRONMENT };
  }

  async quotaSnapshot(platform: 'youtube' | 'twitch' | 'kick') {
    return quotaGovernor.snapshot(platform);
  }

  async syncAccount(input: SyncAccountInput): Promise<SyncAccountResult> {
    try {
      return await syncPlatformAccount(this.env.DB, this.env, input, {
        quota: quotaGovernor,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Engine syncAccount(${input.platform}:${input.externalId}): ${detail}`);
    }
  }
}

export default {
  async queue(
    batch: MessageBatch<unknown>,
    env: EngineEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (batch.queue === 'ingest-queue') {
      const bodies = batch.messages.map((m) => m.body);
      const result = await processIngestBatch(env.DB, bodies);
      if (result.failed === 0) {
        for (const message of batch.messages) {
          message.ack();
        }
        return;
      }
      for (const message of batch.messages) {
        message.retry();
      }
      return;
    }

    if (batch.queue === 'notify-queue') {
      const bodies = batch.messages.map((m) => m.body);
      const result = await processNotifyBatch(env.DB, env, bodies);
      if (result.failed === 0) {
        for (const message of batch.messages) {
          message.ack();
        }
        return;
      }
      const retryOpts = result.retryAfterSeconds
        ? { delaySeconds: result.retryAfterSeconds }
        : undefined;
      for (const message of batch.messages) {
        message.retry(retryOpts);
      }
      return;
    }

    for (const message of batch.messages) {
      message.ack();
    }
  },

  async scheduled(
    _controller: ScheduledController,
    env: EngineEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await env.DB.prepare('DELETE FROM webhook_dedupe WHERE expires_at <= ?').bind(nowIso).run();
    await processUnclaimedEscalations(env.DB, env, nowIso);

    const ytRows = await env.DB.prepare(
      `SELECT pa.external_id, MAX(f.starred) AS starred
       FROM platform_accounts pa
       INNER JOIN follows f ON f.account_id = pa.id
       WHERE pa.platform = 'youtube'
       GROUP BY pa.id
       LIMIT 25`,
    ).all<{ external_id: string; starred: number }>();

    const accounts = (ytRows.results ?? []).map((r) => ({
      externalId: r.external_id,
      starred: r.starred === 1,
    }));

    if (accounts.length > 0) {
      const ytProvider = env.YOUTUBE_API_KEY
        ? new YouTubeProvider({ apiKey: env.YOUTUBE_API_KEY, quota: quotaGovernor })
        : new YouTubePublicProvider();
      await reconcilePlatformAccounts(env.DB, ytProvider, accounts, quotaGovernor, { nowIso });
    }
  },
};
