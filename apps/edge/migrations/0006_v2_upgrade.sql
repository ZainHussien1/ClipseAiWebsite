-- Clipse Radar D1 Schema (0006_v2_upgrade.sql)
-- V1 Hardening: backfill/shorts metadata, OTP + PBKDF2 auth, saved views, seen state, creator notes, alert deliveries

ALTER TABLE items ADD COLUMN is_backfill INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN duration_sec INTEGER;
ALTER TABLE items ADD COLUMN shorts_classification TEXT CHECK (shorts_classification IN ('video', 'short', 'live', 'unclassified'));
ALTER TABLE items ADD COLUMN last_synced_at TEXT;

ALTER TABLE follows ADD COLUMN last_viewed_at TEXT;

ALTER TABLE memberships ADD COLUMN passphrase_hash TEXT;
ALTER TABLE memberships ADD COLUMN availability_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE memberships ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';

CREATE TABLE IF NOT EXISTS auth_otps (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_otps_email_created
  ON auth_otps (email, created_at DESC);

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_saved_views_workspace_user
  ON saved_views (workspace_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS item_seen (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, user_id, item_id)
);

CREATE TABLE IF NOT EXISTS creator_notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, account_id)
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_workspace_alert
  ON alert_deliveries (workspace_id, alert_id);

ALTER TABLE clips ADD COLUMN manual_revenue_cents INTEGER;
ALTER TABLE clips ADD COLUMN publish_time TEXT;

ALTER TABLE notification_prefs ADD COLUMN discord_daily_digest INTEGER NOT NULL DEFAULT 0;
