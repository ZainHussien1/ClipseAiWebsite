-- Clipse Radar D1 Schema (0007_v3_board.sql)
-- V3: Kanban Work Board states (Clipping, Published) + clip_url on claims

CREATE TABLE IF NOT EXISTS claims_v4 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  start_sec INTEGER,
  end_sec INTEGER,
  status TEXT NOT NULL CHECK (status IN ('New', 'Claimed', 'Clipping', 'Clipped', 'Published', 'Skipped')),
  note TEXT,
  clip_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO claims_v4 (id, workspace_id, item_id, user_id, start_sec, end_sec, status, note, created_at, updated_at)
SELECT id, workspace_id, item_id, user_id, start_sec, end_sec, status, note, created_at, updated_at FROM claims;

DROP TABLE claims;
ALTER TABLE claims_v4 RENAME TO claims;

CREATE INDEX IF NOT EXISTS idx_claims_workspace_item_range
  ON claims (workspace_id, item_id, start_sec, end_sec);

CREATE INDEX IF NOT EXISTS idx_claims_workspace_user_created
  ON claims (workspace_id, user_id, created_at DESC, id);
