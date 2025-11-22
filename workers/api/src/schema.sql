-- D1 schema generated from workers/api/src/schema.ts (Drizzle is the source of truth).
-- Apply via pnpm d1:apply for new environments.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  bio TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free','creator','pro','team') OR plan IS NULL),
  storage_usage_bytes INTEGER NOT NULL DEFAULT 0,
  storage_version INTEGER NOT NULL DEFAULT 0,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  posts_count INTEGER DEFAULT 0,
  runs_count INTEGER DEFAULT 0,
  remixes_count INTEGER DEFAULT 0,
  primary_tags TEXT,
  is_featured INTEGER DEFAULT 0,
  is_suspended INTEGER DEFAULT 0,
  shadow_banned INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tagline TEXT,
  location TEXT,
  website_url TEXT,
  x_handle TEXT,
  github_handle TEXT,
  pronouns TEXT,
  search_tags TEXT,
  about_md TEXT,
  layout_version INTEGER NOT NULL DEFAULT 1,
  pinned_capsules TEXT,
  profile_capsule_id TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS profile_themes (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  mode TEXT NOT NULL DEFAULT 'system' CHECK (mode IN ('system','light','dark')),
  accent_hue INTEGER NOT NULL DEFAULT 260,
  accent_saturation INTEGER NOT NULL DEFAULT 80,
  accent_lightness INTEGER NOT NULL DEFAULT 60,
  radius_scale INTEGER NOT NULL DEFAULT 2,
  density TEXT NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable','cozy','compact')),
  accent_color TEXT,
  bg_color TEXT,
  text_color TEXT,
  font_family TEXT,
  cover_image_url TEXT,
  glass INTEGER NOT NULL DEFAULT 0,
  canvas_blur INTEGER
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

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  capsule_id TEXT NOT NULL REFERENCES capsules(id),
  type TEXT NOT NULL,
  runtime_version TEXT,
  bundle_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','quarantined','removed','draft')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','private')),
  policy_status TEXT NOT NULL DEFAULT 'active' CHECK (policy_status IN ('active','quarantined','removed')),
  safety_tier TEXT NOT NULL DEFAULT 'default',
  risk_score INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at INTEGER,
  last_reviewed_by TEXT REFERENCES users(id),
  deleted_at INTEGER,
  deleted_by TEXT REFERENCES users(id),
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS artifact_manifests (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  runtime_version TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('app','report')),
  capsule_id TEXT REFERENCES capsules(id),
  report_md TEXT,
  cover_key TEXT,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','private')),
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
  status TEXT CHECK (status IN ('started','completed','failed','killed') OR status IS NULL),
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  at_ms INTEGER,
  bbox TEXT,
  parent_comment_id TEXT,
  quarantined INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id),
  followee_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS remixes (
  child_capsule_id TEXT NOT NULL REFERENCES capsules(id),
  parent_capsule_id TEXT NOT NULL REFERENCES capsules(id),
  created_at INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (child_capsule_id, parent_capsule_id)
);

CREATE TABLE IF NOT EXISTS likes (
  user_id TEXT NOT NULL REFERENCES users(id),
  post_id TEXT NOT NULL REFERENCES posts(id),
  created_at INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  post_id TEXT REFERENCES posts(id),
  comment_id TEXT REFERENCES comments(id),
  reason TEXT NOT NULL CHECK (reason IN ('spam','harassment','inappropriate','copyright','malware','other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','resolved','dismissed')),
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS live_waitlist (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  email TEXT NOT NULL,
  handle TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('free','creator','pro','team')),
  user_id TEXT REFERENCES users(id),
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS profile_blocks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  position INTEGER NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','followers','private')),
  config_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS custom_fields (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  icon TEXT,
  config_json TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  cover_key TEXT,
  tags TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS profile_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

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

CREATE TABLE IF NOT EXISTS handle_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  handle TEXT NOT NULL,
  valid_until INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);
