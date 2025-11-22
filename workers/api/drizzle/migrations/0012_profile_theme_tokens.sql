-- Migration 0012: introduce profile_themes table with richer theme tokens.
-- SAFETY: Creates the table if missing. Existing deployments without this table will get the final shape directly.

CREATE TABLE IF NOT EXISTS profile_themes (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  mode TEXT NOT NULL DEFAULT 'system',
  accent_hue INTEGER NOT NULL DEFAULT 260,
  accent_saturation INTEGER NOT NULL DEFAULT 80,
  accent_lightness INTEGER NOT NULL DEFAULT 60,
  radius_scale INTEGER NOT NULL DEFAULT 2,
  density TEXT NOT NULL DEFAULT 'comfortable',
  accent_color TEXT,
  bg_color TEXT,
  text_color TEXT,
  font_family TEXT,
  cover_image_url TEXT,
  glass INTEGER NOT NULL DEFAULT 0,
  canvas_blur INTEGER
);
