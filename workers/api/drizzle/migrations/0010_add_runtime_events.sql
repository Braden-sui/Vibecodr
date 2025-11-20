-- Migration 0010: add runtime_events table for the analytics dashboard

CREATE TABLE IF NOT EXISTS runtime_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  capsule_id TEXT,
  artifact_id TEXT,
  runtime_type TEXT,
  runtime_version TEXT,
  code TEXT,
  message TEXT,
  properties TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_runtime_events_created_at ON runtime_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_events_event_name ON runtime_events(event_name);
