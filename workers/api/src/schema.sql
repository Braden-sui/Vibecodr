-- D1 schema skeleton for Vibecodr. Aligns with docs/mvp-plan.md.
-- TODO: Migrations via Drizzle or Kysely later.

-- Identity: immutable anchor used for auth/account linkage and SSOT for IDs/handles.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  handle TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  bio TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  storage_usage_bytes INTEGER NOT NULL DEFAULT 0,
  storage_version INTEGER NOT NULL DEFAULT 0,
  followers_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  posts_count INTEGER NOT NULL DEFAULT 0,
  runs_count INTEGER NOT NULL DEFAULT 0,
  remixes_count INTEGER NOT NULL DEFAULT 0,
  primary_tags TEXT,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_suspended INTEGER NOT NULL DEFAULT 0,
  shadow_banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Vanity/representation: mutable profile metadata keyed to user_id (1:1).
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  tagline TEXT,
  location TEXT,
  website_url TEXT,
  x_handle TEXT,
  github_handle TEXT,
  pronouns TEXT,
  search_tags TEXT,
  about_md TEXT,
  layout_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
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
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  report_md TEXT,
  cover_key TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  quarantined INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  runs_count INTEGER DEFAULT 0,
  remixes_count INTEGER DEFAULT 0,
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
   parent_comment_id TEXT REFERENCES comments(id),
  quarantined INTEGER DEFAULT 0,
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
