-- Track storage usage and optimistic version per user for capsule uploads
-- Tier: T1 (public API storage accounting, reversible via column drop)

ALTER TABLE users ADD COLUMN storage_usage_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN storage_version INTEGER NOT NULL DEFAULT 0;

-- Backfill usage from existing capsule assets
UPDATE users
SET storage_usage_bytes = COALESCE((
  SELECT SUM(a.size)
  FROM capsules c
  JOIN assets a ON a.capsule_id = c.id
  WHERE c.owner_id = users.id
), 0);
