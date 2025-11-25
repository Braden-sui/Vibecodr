-- Tier: T2 (taxonomy refactor with data rewrite). Idempotent for reruns.
-- Purpose: migrate legacy post types into the unified vibe taxonomy and fix CHECK constraint.

PRAGMA foreign_keys=OFF;

-- Rebuild posts with the expanded type set and normalize legacy values.
DROP TABLE IF EXISTS posts_new;

CREATE TABLE posts_new (
  id text PRIMARY KEY NOT NULL,
  author_id text NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('thought', 'image', 'link', 'app', 'longform')),
  capsule_id text REFERENCES capsules(id),
  report_md text,
  cover_key text,
  title text NOT NULL,
  description text,
  tags text,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','private')),
  quarantined integer DEFAULT 0,
  likes_count integer DEFAULT 0,
  comments_count integer DEFAULT 0,
  runs_count integer DEFAULT 0,
  remixes_count integer DEFAULT 0,
  created_at integer DEFAULT (strftime('%s','now'))
);

INSERT INTO posts_new (
  id,
  author_id,
  type,
  capsule_id,
  report_md,
  cover_key,
  title,
  description,
  tags,
  visibility,
  quarantined,
  likes_count,
  comments_count,
  runs_count,
  remixes_count,
  created_at
)
SELECT
  p.id,
  p.author_id,
  CASE
    WHEN p.type = 'report' THEN 'thought'
    WHEN p.type IS NULL OR p.type NOT IN ('thought','image','link','app','longform') THEN 'thought'
    ELSE p.type
  END AS type,
  p.capsule_id,
  p.report_md,
  p.cover_key,
  p.title,
  p.description,
  p.tags,
  p.visibility,
  p.quarantined,
  p.likes_count,
  p.comments_count,
  p.runs_count,
  p.remixes_count,
  p.created_at
FROM posts p
LEFT JOIN users u ON u.id = p.author_id
LEFT JOIN capsules c ON c.id = p.capsule_id
WHERE u.id IS NOT NULL
  AND (p.capsule_id IS NULL OR c.id IS NOT NULL);

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

-- Recreate index for public, non-quarantined posts ordered by recency.
DROP INDEX IF EXISTS idx_posts_public_recent;
CREATE INDEX IF NOT EXISTS idx_posts_public_recent
  ON posts(created_at DESC)
  WHERE visibility = 'public' AND (quarantined IS NULL OR quarantined = 0);

PRAGMA foreign_keys=ON;
