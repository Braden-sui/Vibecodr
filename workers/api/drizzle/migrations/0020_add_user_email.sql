-- Tier: T1 (schema additive + unique index). Adds user email storage and unique normalized index.

ALTER TABLE users ADD COLUMN email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users(LOWER(email))
  WHERE email IS NOT NULL;
