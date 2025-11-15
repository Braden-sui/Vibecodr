-- Add denormalized counters to posts for likes/comments/runs/remixes
-- Tier: T1 (public API-adjacent, but current reads still derive stats from base tables)

ALTER TABLE posts ADD COLUMN likes_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN comments_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN runs_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN remixes_count INTEGER NOT NULL DEFAULT 0;
