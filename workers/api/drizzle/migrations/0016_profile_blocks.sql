-- Migration 0016: ensure profile_blocks table exists for profile layouts.
-- SAFETY: IF NOT EXISTS to avoid conflicts.

CREATE TABLE IF NOT EXISTS profile_blocks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  position INTEGER NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  config_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_profile_blocks_user_id ON profile_blocks(user_id);
