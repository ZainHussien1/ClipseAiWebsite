-- Clipse Radar D1 Schema (0008_v4_alerts.sql)
-- V4: alert acknowledgement, notification rules JSON, nullable alert_id on alert_deliveries for test notifications

ALTER TABLE notification_prefs ADD COLUMN rules_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE alerts ADD COLUMN acknowledged_at TEXT;

CREATE TABLE IF NOT EXISTS alert_deliveries_v4 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  alert_id TEXT REFERENCES alerts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT
);

INSERT INTO alert_deliveries_v4 (id, workspace_id, alert_id, channel, status, reason, attempted_at, delivered_at)
SELECT id, workspace_id, alert_id, channel, status, reason, attempted_at, delivered_at FROM alert_deliveries;

DROP TABLE alert_deliveries;
ALTER TABLE alert_deliveries_v4 RENAME TO alert_deliveries;

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_workspace_alert
  ON alert_deliveries (workspace_id, alert_id, attempted_at DESC);
