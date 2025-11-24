-- Tier: T0 (indexes only). Safe to re-run.
-- Purpose: accelerate feed queries and comment loading by aligning indexes with hot predicates.

-- Feed filtering: public and not quarantined ordered by recency.
CREATE INDEX IF NOT EXISTS idx_posts_public_recent
  ON posts(created_at DESC)
  WHERE visibility = 'public' AND (quarantined IS NULL OR quarantined = 0);

-- Artifact resolution for runtime: active, policy-active, and visible artifacts per capsule.
CREATE INDEX IF NOT EXISTS idx_artifacts_active_visible_capsule
  ON artifacts(capsule_id, created_at DESC)
  WHERE status = 'active' AND policy_status = 'active' AND visibility IN ('public','unlisted');

-- Comment loading: visible comments per post in creation order.
CREATE INDEX IF NOT EXISTS idx_comments_visible_post_created
  ON comments(post_id, created_at ASC)
  WHERE quarantined IS NULL OR quarantined = 0;
