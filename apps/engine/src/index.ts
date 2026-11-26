import { WorkerEntrypoint } from 'cloudflare:workers';
import { TokenBucketQuotaGovernor } from '@clipse/core';
import { processIngestBatch } from './ingest.js';

export interface EngineEnv {
  DB: D1Database;
  ENVIRONMENT: string;
  AI_INSIGHTS_ENABLED: string;
}

const quotaGovernor = new TokenBucketQuotaGovernor();

export class EngineEntrypoint extends WorkerEntrypoint<EngineEnv> {
  async ping(): Promise<{ ok: true; environment: string }> {
    return { ok: true, environment: this.env.ENVIRONMENT };
  }

  async quotaSnapshot(platform: 'youtube' | 'twitch' | 'kick') {
    return quotaGovernor.snapshot(platform);
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
      // On partial failure, ack valid/non-failing or retry batch conservatively
      for (const message of batch.messages) {
        message.retry();
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
    // Prune expired webhook_dedupe rows to keep D1 storage bounded
    const nowIso = new Date().toISOString();
    await env.DB.prepare('DELETE FROM webhook_dedupe WHERE expires_at <= ?').bind(nowIso).run();
  },
};
