-- Migration 0014: add badges catalog and user_badges mapping.
-- SAFETY: Uses IF NOT EXISTS to allow reruns in non-prod environments.

CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  tier TEXT
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL REFERENCES users(id),
  badge_id TEXT NOT NULL REFERENCES badges(id),
  granted_at INTEGER DEFAULT (strftime('%s','now')),
  source TEXT,
  PRIMARY KEY (user_id, badge_id)
);
