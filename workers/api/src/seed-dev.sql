INSERT OR IGNORE INTO users (id, handle, name, avatar_url, bio, plan, created_at)
VALUES
  ('user_demo', 'demo', 'Demo User', NULL, 'Seed demo user', 'creator', strftime('%s','now')),
  ('user_creator', 'creator', 'Creator User', NULL, 'Second seed user', 'free', strftime('%s','now'));

INSERT OR IGNORE INTO profiles (user_id, display_name, avatar_url, bio, tagline, about_md, created_at, updated_at)
VALUES
  ('user_demo', 'Demo User', NULL, 'Seed demo user', 'Building the vibe.', NULL, strftime('%s','now'), strftime('%s','now')),
  ('user_creator', 'Creator User', NULL, 'Second seed user', 'Creator at work.', NULL, strftime('%s','now'), strftime('%s','now'));

INSERT OR IGNORE INTO capsules (id, owner_id, manifest_json, hash, created_at)
VALUES
  (
    'capsule_demo',
    'user_demo',
    '{"version":"1.0","runner":"client-static","entry":"index.html","title":"Demo Capsule","description":"Seed capsule for local/dev"}',
    'capsule-demo-hash',
    strftime('%s','now')
  ),
  (
    'capsule_remix',
    'user_creator',
    '{"version":"1.0","runner":"client-static","entry":"index.html","title":"Remix Capsule","description":"Remix of demo capsule"}',
    'capsule-remix-hash',
    strftime('%s','now')
  );

INSERT OR IGNORE INTO assets (id, capsule_id, key, size)
VALUES
  ('asset_demo_html', 'capsule_demo', 'capsules/capsule_demo/index.html', 1024);

INSERT OR IGNORE INTO posts (id, author_id, type, capsule_id, title, description, tags, report_md, cover_key, created_at)
VALUES
  (
    'post_demo_app',
    'user_demo',
    'app',
    'capsule_demo',
    'Welcome to Vibecodr',
    'Seed app post for local/dev feed',
    '["demo","seed","app"]',
    NULL,
    NULL,
    strftime('%s','now')
  ),
  (
    'post_demo_report',
    'user_creator',
    'report',
    NULL,
    'Seed Report',
    'Seed report post for local/dev feed',
    '["demo","seed","report"]',
    '# Seed Report\n\nThis is seeded report content.',
    NULL,
    strftime('%s','now')
  );

INSERT OR IGNORE INTO runs (id, capsule_id, post_id, user_id, started_at, duration_ms, status)
VALUES
  (
    'run_demo_1',
    'capsule_demo',
    'post_demo_app',
    'user_demo',
    strftime('%s','now') - 60,
    1200,
    'completed'
  );

INSERT OR IGNORE INTO comments (id, post_id, user_id, body, at_ms, bbox, created_at)
VALUES
  (
    'comment_demo_1',
    'post_demo_app',
    'user_creator',
    'Nice capsule!',
    NULL,
    NULL,
    strftime('%s','now')
  );

INSERT OR IGNORE INTO follows (follower_id, followee_id)
VALUES
  ('user_creator', 'user_demo');

INSERT OR IGNORE INTO remixes (child_capsule_id, parent_capsule_id)
VALUES
  ('capsule_remix', 'capsule_demo');

INSERT OR IGNORE INTO likes (user_id, post_id, created_at)
VALUES
  ('user_creator', 'post_demo_app', strftime('%s','now'));

INSERT OR IGNORE INTO notifications (id, user_id, type, actor_id, post_id, comment_id, read, created_at)
VALUES
  (
    'notif_demo_like',
    'user_demo',
    'like',
    'user_creator',
    'post_demo_app',
    NULL,
    0,
    strftime('%s','now')
  );

INSERT OR IGNORE INTO runtime_events (
  id,
  event_name,
  capsule_id,
  artifact_id,
  runtime_type,
  runtime_version,
  code,
  message,
  properties,
  created_at
)
VALUES
  (
    'runtime_demo_boot',
    'runtime_ready',
    'capsule_demo',
    NULL,
    'react-jsx',
    'v0.1.0',
    NULL,
    'Demo runtime ready event',
    '{"capabilities":{"net":[]}}',
    strftime('%s','now')
  );
