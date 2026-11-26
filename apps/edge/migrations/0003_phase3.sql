-- Clipse Radar D1 Schema (0003_phase3.sql)
-- Phase 3: source groups/tags/pause/archive + Claimed/Clipped/Skipped claim states & whole-item/range claims

ALTER TABLE follows ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1));
ALTER TABLE follows ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));
ALTER TABLE follows ADD COLUMN group_name TEXT;
ALTER TABLE follows ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_follows_workspace_active
  ON follows (workspace_id, archived, paused, created_at DESC, id);

CREATE TABLE IF NOT EXISTS claims_v3 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  start_sec INTEGER,
  end_sec INTEGER,
  status TEXT NOT NULL CHECK (status IN ('New', 'Claimed', 'Clipped', 'Skipped')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

DROP TABLE IF EXISTS claims;
ALTER TABLE claims_v3 RENAME TO claims;

CREATE INDEX IF NOT EXISTS idx_claims_workspace_item_range
  ON claims (workspace_id, item_id, start_sec, end_sec);

CREATE INDEX IF NOT EXISTS idx_claims_workspace_user_created
  ON claims (workspace_id, user_id, created_at DESC, id);
