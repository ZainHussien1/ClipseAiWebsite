-- Clipse Radar D1 Schema (0001_init.sql)
-- Global tables (shared across workspaces) + Workspace-scoped tables (tenant-isolated via workspace_id)

PRAGMA foreign_keys = ON;

-- ============================================================================
-- Global Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS platform_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'twitch', 'kick')),
  external_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_accounts_platform_handle
  ON platform_accounts (platform, handle);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'twitch', 'kick')),
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'short', 'live', 'vod', 'clip')),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  published_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  raw_refreshed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  UNIQUE (platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_items_account_published
  ON items (account_id, published_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_items_platform_published
  ON items (platform, published_at DESC, id);

CREATE TABLE IF NOT EXISTS item_stats (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER,
  comments INTEGER
);

CREATE INDEX IF NOT EXISTS idx_item_stats_item_captured
  ON item_stats (item_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS live_samples (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  sampled_at TEXT NOT NULL,
  viewers INTEGER NOT NULL DEFAULT 0,
  is_live INTEGER NOT NULL CHECK (is_live IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_live_samples_item_sampled
  ON live_samples (item_id, sampled_at DESC);

-- ============================================================================
-- Workspace-Scoped Tables (always filtered by workspace_id)
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Owner', 'Admin', 'Member', 'Viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_workspace
  ON memberships (user_id, workspace_id);

CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  is_own INTEGER NOT NULL DEFAULT 0 CHECK (is_own IN (0, 1)),
  rules_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_workspace_starred_created
  ON follows (workspace_id, starred, created_at DESC, id);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  start_sec INTEGER NOT NULL DEFAULT 0,
  end_sec INTEGER,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'in_progress', 'clipped', 'released')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_claims_workspace_item_range
  ON claims (workspace_id, item_id, start_sec, end_sec);

CREATE INDEX IF NOT EXISTS idx_claims_workspace_user_created
  ON claims (workspace_id, user_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  claim_id TEXT REFERENCES claims(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'twitch', 'kick', 'tiktok', 'instagram', 'x')),
  title TEXT,
  manual_stats_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_clips_workspace_created
  ON clips (workspace_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('rising', 'breakout', 'viral', 'live_moment', 'vod_ready')),
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  score REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_workspace_created
  ON alerts (workspace_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_alerts_workspace_item_type
  ON alerts (workspace_id, item_id, type);

CREATE TABLE IF NOT EXISTS alert_votes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  useful INTEGER NOT NULL CHECK (useful IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, alert_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_votes_workspace_alert
  ON alert_votes (workspace_id, alert_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  alert_id TEXT REFERENCES alerts(id) ON DELETE SET NULL,
  tier TEXT NOT NULL CHECK (tier IN ('P1', 'P2', 'P3')),
  channel TEXT NOT NULL CHECK (channel IN ('discord', 'webpush', 'in_app')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_user_created
  ON notifications (workspace_id, user_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created
  ON audit_logs (workspace_id, created_at DESC, id);
