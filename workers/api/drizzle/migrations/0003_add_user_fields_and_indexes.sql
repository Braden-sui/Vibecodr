-- Add missing user profile columns (idempotent-ish: ignore errors if already exist)
-- SQLite (D1) doesn't have robust IF NOT EXISTS for columns; these ALTERs will fail if column exists.
-- Run once on fresh DBs; on existing DBs, comment out lines that already exist.

CREATE TABLE IF NOT EXISTS _schema_guard (name TEXT PRIMARY KEY);

CREATE TRIGGER IF NOT EXISTS add_followers_count_trigger
AFTER INSERT ON _schema_guard
WHEN NEW.name = 'followers_count'
BEGIN
  ALTER TABLE users ADD COLUMN followers_count INTEGER NOT NULL DEFAULT 0;
END;

-- Users table augmentations
INSERT OR IGNORE INTO _schema_guard (name) VALUES ('followers_count');
ALTER TABLE users ADD COLUMN following_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN posts_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN runs_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN remixes_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN primary_tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0; -- 0/1
ALTER TABLE users ADD COLUMN is_suspended INTEGER NOT NULL DEFAULT 0; -- 0/1
ALTER TABLE users ADD COLUMN shadow_banned INTEGER NOT NULL DEFAULT 0; -- 0/1
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'; -- free|creator|pro|team

-- Helpful indexes for feed and social features
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts (author_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows (follower_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_follows_unique ON follows (follower_id, followee_id);
CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes (post_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_unique ON likes (user_id, post_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments (post_id);
CREATE INDEX IF NOT EXISTS idx_runs_capsule_id ON runs (capsule_id);
CREATE INDEX IF NOT EXISTS idx_remixes_parent_capsule_id ON remixes (parent_capsule_id);
