import { WorkerEntrypoint } from 'cloudflare:workers';

export interface EngineEnv {
  DB: D1Database;
  ENVIRONMENT: string;
  AI_INSIGHTS_ENABLED: string;
}

export class EngineEntrypoint extends WorkerEntrypoint<EngineEnv> {
  async ping(): Promise<{ ok: true; environment: string }> {
    return { ok: true, environment: this.env.ENVIRONMENT };
  }
}

export default {
  async queue(
    batch: MessageBatch<unknown>,
    _env: EngineEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    for (const message of batch.messages) {
      message.ack();
    }
  },

  async scheduled(
    _controller: ScheduledController,
    _env: EngineEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Phase 2+ reconciler and cleanup crons
  },
};
