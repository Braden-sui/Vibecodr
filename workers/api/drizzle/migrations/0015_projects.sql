-- Migration 0015: ensure projects table exists for profile rendering.
-- SAFETY: IF NOT EXISTS so reruns are safe.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  cover_key TEXT,
  tags TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
