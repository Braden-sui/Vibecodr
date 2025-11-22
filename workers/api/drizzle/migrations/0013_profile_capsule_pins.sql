-- Migration 0013: add pinned capsules + profile capsule id to profiles table.
-- SAFETY: Adds nullable columns.

ALTER TABLE profiles ADD COLUMN pinned_capsules TEXT;
ALTER TABLE profiles ADD COLUMN profile_capsule_id TEXT;
