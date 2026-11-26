-- Clipse Radar D1 Schema (0005_phase5.sql)
-- Phase 5: Clip Log source linking, manual vs API stats snapshots

ALTER TABLE clips ADD COLUMN source_item_id TEXT REFERENCES items(id) ON DELETE SET NULL;
ALTER TABLE clips ADD COLUMN user_id TEXT;
ALTER TABLE clips ADD COLUMN description TEXT;
ALTER TABLE clips ADD COLUMN is_manual_stats INTEGER NOT NULL DEFAULT 0 CHECK (is_manual_stats IN (0, 1));
ALTER TABLE clips ADD COLUMN needs_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (needs_confirmation IN (0, 1));

CREATE TABLE IF NOT EXISTS clip_stats_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER,
  comments INTEGER,
  source TEXT NOT NULL CHECK (source IN ('api', 'manual')),
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_clip_stats_workspace_clip
  ON clip_stats_snapshots (workspace_id, clip_id, captured_at DESC);
