# Vibecodr Website Skeleton - Sitemap and Ownership Notes

This document lists the major surfaces and their purpose. Each route in apps/web has an accompanying file with explicit responsibilities and TODOs.

- /
  - Runnable feed for App and Report posts
  - Modes: Latest, Following, For You (beta)
  - Search by text and filter by tags; click-to-run inline previews for app posts with a small concurrency cap
- /player/:postId
  - Full-screen Player for a single post
  - Sandboxed iframe, bottom controls (restart/kill/perf, share, report), right drawer tabs (Notes, Remix, Chat)
- /post/new
  - "Share a vibe" composer
  - Imports from GitHub or ZIP via the Worker, then creates an App or Report post
- /post/:id
  - Post detail (App or Report); currently a simple stub that links people back into the player
- /studio
  - Creation hub with tabs: Import, Params, Files, Publish (client-side shell)
- /u/:handle
  - Profile page with layout/blocks, stats (Followers, Following, Posts, Runs, Remixes), and the user’s posts
  - Ownership is on the user (SSOT: id/handle/avatar/bio). Profile rows are metadata keyed by `user_id`.
- /settings
  - Account & plan usage caps UI (static MVP; Worker exposes `/user/quota` for future wiring)
- /pricing
  - Public plans & limits (Free, Creator, Pro, Team)
- /live
  - Placeholder "not live yet" page for the future live capsules hub
- /admin/moderation
  - Simple stub queue for reports/quarantine
- /moderation/flagged
  - Moderator-only list of flagged posts, backed by Worker moderation APIs
- /moderation/audit
  - Admin-only audit log for moderation actions
- /sign-in, /sign-up
  - Auth flows provided by Clerk (sign-in/sign-up screens)

API (Cloudflare Worker, workers/api):

Key routes (see workers/api/src/index.ts for the full list):

- Manifest, capsules, artifacts
  - POST /manifest/validate - validate manifest JSON and return structured errors/warnings
  - POST /capsules/publish - validate bundle, enforce plan quotas, upload to R2, create capsule record
  - GET /capsules/:id - capsule details + manifest + R2 metadata
  - GET /capsules/:id/verify - integrity check only
  - GET /capsules/:id/manifest - Player fetches runtime manifest
  - GET /capsules/:id/bundle - iframe entry file with strict CSP
  - POST /artifacts, PUT /artifacts/:id/sources, PUT /artifacts/:id/complete, GET /artifacts/:id/manifest - runtime artifact pipeline

- Import
  - POST /import/github - create capsule draft from a GitHub repo
  - POST /import/zip - create capsule draft from uploaded ZIP

- Feed, posts, and social
  - GET /posts?mode=latest|following|foryou&q=&tags= - feed backing the homepage lanes
  - GET /posts/:id - single post payload for Player
  - POST /posts - create a new post (app/report) using the authed user id
  - POST /posts/:id/like, DELETE /posts/:id/like, GET /posts/:id/likes
  - POST /posts/:id/comments, GET /posts/:id/comments, DELETE /comments/:id

- Profiles, follows, and quota
  - POST /users/sync - upsert basic user identity from Clerk (handle/name/avatar/bio/plan). `users` stays the SSOT.
  - GET /users/:handle - profile header + stats (users joined with profile metadata)
  - GET /users/:handle/posts - recent posts for that user
  - GET /users/:id/check-following - whether the current user follows a target
  - POST /users/:id/follow, DELETE /users/:id/follow, plus followers/following lists
  - GET /user/quota - current user plan, storage, and run usage/limits

- Notifications
  - GET /notifications - paginated notifications list
  - GET /notifications/summary - unread count + notifications in one payload
  - GET /notifications/unread-count - unread badge count for UI
  - POST /notifications/mark-read - mark some or all notifications as read

- Moderation & safety
  - POST /moderation/report - flag content
  - GET /moderation/flagged-posts - aggregate flagged posts for moderators
  - GET /moderation/reports - detailed moderation reports queue
  - POST /moderation/reports/:id/resolve - resolve a report with an action
  - POST /moderation/posts/:id/action - direct moderation actions on posts
  - POST /moderation/comments/:id/action - direct moderation actions on comments
  - POST /moderation/filter-content - keyword filter helper used before writes
  - GET /moderation/audit - audit log (admin)

- Embeds & proxy
  - GET /oembed - oEmbed JSON for `/player/:id` and `/e/:id`
  - GET /e/:id - embeddable iframe wrapper around the Player
  - GET /og-image/:id - branded SVG Open Graph image for posts
  - GET /proxy?url=...&capsuleId=... - allowlisted network proxy with per-capsule/host rate limiting

- Runs & runtime events
  - POST /runs/complete - record a completed Player run (optionally tied to a post)
  - POST /runs/:id/logs - append logs from runner (currently a stub that returns 501)
  - POST /runtime-events - append runtime telemetry

DB (D1, workers/api/src/schema.ts):
- Identity: users (SSOT for auth/handle/avatar/bio/plan)
- Profile metadata: profiles (1:1 via user_id), profile_themes, profile_blocks, custom_fields, projects, profile_links, badges, user_badges, handle_history
- Capsules runtime: capsules, assets, artifacts, artifact_manifests
- Social: posts (author_id), comments, likes, follows, remixes, runs
- Notifications, moderation reports/audit, runtime_events
