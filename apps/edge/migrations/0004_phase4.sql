-- Clipse Radar D1 Schema (0004_phase4.sql)
-- Phase 4: notification preferences, Web Push subscriptions, encrypted Discord webhooks, escalation tracking

CREATE TABLE IF NOT EXISTS notification_prefs (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  hourly_budget INTEGER NOT NULL DEFAULT 10,
  quiet_start_hour INTEGER,
  quiet_end_hour INTEGER,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  snooze_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_workspace_user
  ON push_subscriptions (workspace_id, user_id);

ALTER TABLE workspaces ADD COLUMN discord_webhook_enc TEXT;
ALTER TABLE alerts ADD COLUMN reminded_at TEXT;
