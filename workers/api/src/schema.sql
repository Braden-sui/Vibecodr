-- D1 schema skeleton for Vibecodr. Aligns with docs/mvp-plan.md.
-- TODO: Migrations via Drizzle or Kysely later.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  bio TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'creator', 'pro', 'team')),
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS capsules (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  manifest_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  capsule_id TEXT NOT NULL REFERENCES capsules(id),
  key TEXT NOT NULL,
  size INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('app','report')),
  capsule_id TEXT REFERENCES capsules(id),
  title TEXT,
  description TEXT,
  tags TEXT,
  report_md TEXT,
  cover_key TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  capsule_id TEXT NOT NULL REFERENCES capsules(id),
  post_id TEXT REFERENCES posts(id),
  user_id TEXT REFERENCES users(id),
  started_at INTEGER,
  duration_ms INTEGER,
  status TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  at_ms INTEGER,
  bbox TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id),
  followee_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS remixes (
  child_capsule_id TEXT NOT NULL REFERENCES capsules(id),
  parent_capsule_id TEXT NOT NULL REFERENCES capsules(id),
  PRIMARY KEY (child_capsule_id, parent_capsule_id)
);

