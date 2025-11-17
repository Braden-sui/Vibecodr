-- D1 schema skeleton for Vibecodr. Aligns with docs/mvp-plan.md.
-- TODO: Migrations via Drizzle or Kysely later.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  bio TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'creator', 'pro', 'team')),
  storage_usage_bytes INTEGER NOT NULL DEFAULT 0,
  storage_version INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS likes (
  user_id TEXT NOT NULL REFERENCES users(id),
  post_id TEXT NOT NULL REFERENCES posts(id),
  created_at INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('like','comment','follow','remix')),
  actor_id TEXT NOT NULL REFERENCES users(id),
  post_id TEXT REFERENCES posts(id),
  comment_id TEXT REFERENCES comments(id),
  read INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

-- Moderation tables
CREATE TABLE IF NOT EXISTS moderation_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate', 'copyright', 'other')),
  details TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolved_by TEXT REFERENCES users(id),
  resolved_at INTEGER,
  resolution_action TEXT CHECK (resolution_action IN ('dismiss', 'quarantine', 'remove')),
  resolution_notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS moderation_audit_log (
  id TEXT PRIMARY KEY,
  moderator_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_status ON moderation_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_target ON moderation_reports(target_type, target_id);

-- Runtime artifacts tables
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  capsule_id TEXT NOT NULL REFERENCES capsules(id),
  type TEXT NOT NULL,
  runtime_version TEXT,
  bundle_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'quarantined', 'removed', 'draft')) DEFAULT 'active',
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'unlisted', 'private')) DEFAULT 'public',
  policy_status TEXT NOT NULL CHECK (policy_status IN ('active', 'quarantined', 'removed')) DEFAULT 'active',
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

CREATE INDEX IF NOT EXISTS idx_artifacts_capsule ON artifacts(capsule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_owner_created ON artifacts(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_policy_status ON artifacts(policy_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifact_manifests_artifact ON artifact_manifests(artifact_id, version DESC);
