-- Clipse Radar D1 Schema (0002_ingestion.sql)
-- Webhook replay dedupe, subscription lease tracking, and ingestion scorecard metrics

CREATE TABLE IF NOT EXISTS webhook_dedupe (
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'twitch', 'kick')),
  message_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (platform, message_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_dedupe_expires
  ON webhook_dedupe (expires_at);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'twitch', 'kick')),
  account_external_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (platform, account_external_id, topic)
);

CREATE TABLE IF NOT EXISTS ingestion_metrics (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'twitch', 'kick')),
  metric_date TEXT NOT NULL,
  pushes_received INTEGER NOT NULL DEFAULT 0,
  missed_pushes INTEGER NOT NULL DEFAULT 0,
  reconcile_runs INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (platform, metric_date)
);
