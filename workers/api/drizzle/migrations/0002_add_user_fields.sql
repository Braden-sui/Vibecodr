-- Migration: add counters, primary tags, and moderation flags to users
-- NOTE: 'plan' already exists in the base schema.
-- This migration intentionally fails if columns already exist (SQLite will error on duplicate columns),
-- which is preferable to silently diverging from expected schema.

ALTER TABLE users ADD COLUMN followers_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN following_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN posts_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN runs_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN remixes_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN primary_tags TEXT;
ALTER TABLE users ADD COLUMN is_featured INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN shadow_banned INTEGER DEFAULT 0;
