import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  exchangeKickAppToken,
  exchangeTwitchAppToken,
  KickProvider,
  TokenBucketQuotaGovernor,
  TwitchProvider,
  YouTubeProvider,
  YouTubePublicProvider,
  type Platform,
} from '@clipse/core';
import { enforceYouTube30DayCompliance } from './compliance.js';
import { processIngestBatch } from './ingest.js';
import { processNotifyBatch, processUnclaimedEscalations } from './notify.js';
import { verifyProviderCredentials, type ProviderVerifyResult } from './provider-sync.js';
import { reconcilePlatformAccounts } from './reconciler.js';
import { syncPlatformAccount, type SyncAccountInput, type SyncAccountResult } from './sync.js';

export interface EngineEnv {
  DB: D1Database;
  ENVIRONMENT: string;
  AI_INSIGHTS_ENABLED: string;
  NOTIFY_QUEUE?: Queue;
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

async function listFollowedAccounts(db: D1Database, platform: Platform) {
  const rows = await db
    .prepare(
      `SELECT pa.external_id, MAX(f.starred) AS starred
       FROM platform_accounts pa
       INNER JOIN follows f ON f.account_id = pa.id
       WHERE pa.platform = ?
       GROUP BY pa.id
       LIMIT 25`,
    )
    .bind(platform)
    .all<{ external_id: string; starred: number }>();

  return (rows.results ?? []).map((r) => ({
    externalId: r.external_id,
    starred: r.starred === 1,
  }));
}

export class EngineEntrypoint extends WorkerEntrypoint<EngineEnv> {
  async ping(): Promise<{ ok: true; environment: string }> {
    return { ok: true, environment: this.env.ENVIRONMENT };
  }

  async quotaSnapshot(platform: Platform) {
    return quotaGovernor.snapshot(platform);
  }

  async verifyProviderConnection(platform: Platform): Promise<ProviderVerifyResult> {
    return verifyProviderCredentials(this.env, platform, { quota: quotaGovernor });
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
    if (batch.queue.startsWith('ingest-queue')) {
      const bodies = batch.messages.map((m) => m.body);
      const result = await processIngestBatch(env.DB, bodies);
      for (const message of batch.messages) {
        if (result.failed === 0) message.ack();
        else message.retry();
      }
      return;
    }

    if (batch.queue.startsWith('notify-queue')) {
      const bodies = batch.messages.map((m) => m.body);
      const result = await processNotifyBatch(env.DB, env, bodies);
      const retryOpts = result.retryAfterSeconds
        ? { delaySeconds: result.retryAfterSeconds }
        : undefined;
      for (const message of batch.messages) {
        if (result.failed === 0) message.ack();
        else message.retry(retryOpts);
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
    await enforceYouTube30DayCompliance(env.DB, nowIso);
    await processUnclaimedEscalations(env.DB, env, nowIso);

    const ytAccounts = await listFollowedAccounts(env.DB, 'youtube');
    if (ytAccounts.length > 0) {
      const ytProvider = env.YOUTUBE_API_KEY
        ? new YouTubeProvider({ apiKey: env.YOUTUBE_API_KEY, quota: quotaGovernor })
        : new YouTubePublicProvider();
      await reconcilePlatformAccounts(env.DB, ytProvider, ytAccounts, quotaGovernor, { nowIso });
    }

    if (env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET) {
      const twAccounts = await listFollowedAccounts(env.DB, 'twitch');
      if (twAccounts.length > 0) {
        const token = await exchangeTwitchAppToken(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
        const twProvider = new TwitchProvider({
          clientId: env.TWITCH_CLIENT_ID,
          appAccessToken: token.accessToken,
          quota: quotaGovernor,
        });
        await reconcilePlatformAccounts(env.DB, twProvider, twAccounts, quotaGovernor, { nowIso });
      }
    }

    if (env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET) {
      const kkAccounts = await listFollowedAccounts(env.DB, 'kick');
      if (kkAccounts.length > 0) {
        const token = await exchangeKickAppToken(env.KICK_CLIENT_ID, env.KICK_CLIENT_SECRET);
        const kkProvider = new KickProvider({
          accessToken: token.accessToken,
          quota: quotaGovernor,
        });
        await reconcilePlatformAccounts(env.DB, kkProvider, kkAccounts, quotaGovernor, { nowIso });
      }
    }
  },
};
