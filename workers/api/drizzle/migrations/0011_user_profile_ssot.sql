-- Migration 0011: make profile a metadata table keyed by user_id and hydrate from users.
-- T2: schema reshape with data copy. Run on staging first; rollback by restoring table backup.

-- SAFETY: Some environments never created the legacy profiles table; ensure a compatible source exists.
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  tagline TEXT,
  location TEXT,
  website_url TEXT,
  x_handle TEXT,
  github_handle TEXT,
  pronouns TEXT,
  search_tags TEXT,
  about_md TEXT,
  layout_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS profiles_new (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  tagline TEXT,
  location TEXT,
  website_url TEXT,
  x_handle TEXT,
  github_handle TEXT,
  pronouns TEXT,
  search_tags TEXT,
  about_md TEXT,
  layout_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Copy existing profile rows; new metadata fields are filled later from users as needed.
INSERT OR IGNORE INTO profiles_new (
  user_id,
  tagline,
  location,
  website_url,
  x_handle,
  github_handle,
  pronouns,
  search_tags,
  about_md,
  layout_version,
  created_at,
  updated_at
)
SELECT
  user_id,
  tagline,
  location,
  website_url,
  x_handle,
  github_handle,
  pronouns,
  search_tags,
  about_md,
  COALESCE(layout_version, 1) AS layout_version,
  created_at,
  updated_at
FROM profiles;

DROP TABLE IF EXISTS profiles;
ALTER TABLE profiles_new RENAME TO profiles;

-- Hydrate display metadata from the user record so feeds/profile views stay stable.
UPDATE profiles
SET
  display_name = COALESCE(display_name, (SELECT name FROM users WHERE id = profiles.user_id)),
  avatar_url = COALESCE(avatar_url, (SELECT avatar_url FROM users WHERE id = profiles.user_id)),
  bio = COALESCE(bio, (SELECT bio FROM users WHERE id = profiles.user_id));

-- Ensure every user has a profile row after the reshape.
INSERT OR IGNORE INTO profiles (
  user_id,
  display_name,
  avatar_url,
  bio,
  tagline,
  location,
  website_url,
  x_handle,
  github_handle,
  pronouns,
  search_tags,
  about_md,
  layout_version,
  created_at,
  updated_at
)
SELECT
  id,
  name,
  avatar_url,
  bio,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  1,
  COALESCE(created_at, strftime('%s','now')),
  COALESCE(created_at, strftime('%s','now'))
FROM users;
