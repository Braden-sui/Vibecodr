-- Add quarantined flags to posts and comments
-- Tier: T1 (public API behavior change guarded by role checks)

ALTER TABLE posts ADD COLUMN IF NOT EXISTS quarantined INTEGER DEFAULT 0;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS quarantined INTEGER DEFAULT 0;

-- Helpful indexes for filtered reads
CREATE INDEX IF NOT EXISTS idx_posts_quarantined ON posts(quarantined, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_quarantined ON comments(post_id, quarantined, created_at ASC);
