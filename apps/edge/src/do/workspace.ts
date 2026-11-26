import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({
    type: z.literal('resume'),
    lastEventId: z.number().int().nonnegative(),
  }),
]);

export interface WorkspaceEvent {
  readonly id: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

export class WorkspaceDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS ws_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== 'string' || message.length > 4096) {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_MESSAGE' }));
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(message);
    } catch {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_JSON' }));
      return;
    }

    const result = clientMessageSchema.safeParse(parsedJson);
    if (!result.success) {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_SCHEMA' }));
      return;
    }

    if (result.data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', ts: new Date().toISOString() }));
      return;
    }

    const rows = this.ctx.storage.sql
      .exec<{ id: number; type: string; payload: string; created_at: string }>(
        'SELECT id, type, payload, created_at FROM ws_events WHERE id > ? ORDER BY id ASC LIMIT 100',
        result.data.lastEventId,
      )
      .toArray();

    for (const row of rows) {
      ws.send(
        JSON.stringify({
          type: 'event',
          id: row.id,
          eventType: row.type,
          payload: JSON.parse(row.payload) as unknown,
          createdAt: row.created_at,
        }),
      );
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Socket already closed
    }
  }

  emitEvent(type: string, payload: unknown): WorkspaceEvent {
    const createdAt = new Date().toISOString();
    const serialized = JSON.stringify(payload);
    this.ctx.storage.sql.exec(
      'INSERT INTO ws_events (type, payload, created_at) VALUES (?, ?, ?)',
      type,
      serialized,
      createdAt,
    );

    const row = this.ctx.storage.sql
      .exec<{ id: number }>('SELECT last_insert_rowid() AS id')
      .one();

    const event: WorkspaceEvent = {
      id: row.id,
      type,
      payload,
      createdAt,
    };

    const frame = JSON.stringify({
      type: 'event',
      id: event.id,
      eventType: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    });

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(frame);
      } catch {
        // Dead socket will be cleaned up on close
      }
    }

    return event;
  }
}
