-- Add parent_comment_id for threaded comment replies
-- Tier: T2 (data shape change with reversible column drop)

ALTER TABLE comments ADD COLUMN parent_comment_id TEXT REFERENCES comments(id);

-- Index to efficiently fetch replies for a given parent comment
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id, created_at ASC);

