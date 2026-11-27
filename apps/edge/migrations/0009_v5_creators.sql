-- Clipse Radar D1 Schema (0009_v5_creators.sql)
-- V5: Clip range columns, creator notes index, and DLQ tracking for Admin Health & Retry

ALTER TABLE clips ADD COLUMN start_sec INTEGER;
ALTER TABLE clips ADD COLUMN end_sec INTEGER;

CREATE TABLE IF NOT EXISTS creator_notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, account_id)
);

CREATE TABLE IF NOT EXISTS dlq_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  queue_name TEXT NOT NULL CHECK (queue_name IN ('ingest-dlq', 'notify-dlq')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  error_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retried', 'discarded')),
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  retried_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dlq_messages_status_created
  ON dlq_messages (status, created_at DESC);
