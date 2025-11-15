-- Add runtime artifacts tables for iframe/runtime loader
-- Tier: T1 (public-facing runtime behavior, reversible via table drop)

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
