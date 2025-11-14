# Vibecodr Website Skeleton – Sitemap and Ownership Notes

This document lists the major surfaces and their purpose. Each route in apps/web has an accompanying file with verbose TODOs.

- /
  - Feed with App and Report posts
  - Modes: Latest, Following (MVP)
  - Preloads capsule manifests for cards in viewport
- /player/[postId]
  - Full-screen Player: sandboxed iframe, params drawer, remix, comments
- /live
  - Phase 5 beta hub for project showcase streams—demo capsules, feature walkthroughs, or coding sessions—with waitlisted sessions, live minutes context, and waitlist dialog
- /studio
  - Creation hub with tabs: Import, Params, Files, Publish
- /post/[id]
  - Post detail (App or Report)
- /report/new
  - Report composer with inline snapshots
- /profile/[handle]
  - Profile with Runs/Remixes counts and posts
- /settings
  - Account + plan usage caps
- /admin/moderation
  - Simple queue for reports/quarantine

API (Cloudflare Worker, workers/api):
- POST /import/zip → create capsule draft
- POST /capsules/:id/publish → finalize immutable bundle
- GET /capsules/:id/manifest → used by Player
- POST /runs/:id/logs → logs from runner
- POST /posts → create a new post (app/report)
- POST /moderation/report → flag content
- GET /proxy?host=… → allowlist network proxy
- POST /live/waitlist → requests access to limited live minutes during Phase 5 beta

DB (D1, workers/api/src/schema.sql): users, capsules, assets, posts, runs, comments, follows, remixes.
