-- Indexes only (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts (author_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows (follower_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_follows_unique ON follows (follower_id, followee_id);
CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes (post_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_unique ON likes (user_id, post_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments (post_id);
CREATE INDEX IF NOT EXISTS idx_runs_capsule_id ON runs (capsule_id);
CREATE INDEX IF NOT EXISTS idx_remixes_parent_capsule_id ON remixes (parent_capsule_id);
