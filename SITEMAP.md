# Vibecodr Website Skeleton - Sitemap and Ownership Notes

Major surfaces and their responsibilities. UI routes live in `apps/web`, Worker routes live in `workers/api`.

## Web SPA (apps/web)
- `/` – Runnable feed with tabs (latest, following, foryou), text search via `?q=`, tag filters via `?tags=`, and inline run buttons that respect runtime budgets.
- `/discover` – Tag-focused lane backed by `/posts/discover`; defaults to featured tags and lets users follow a tag filter.
- `/post/new` (alias `/composer`) – VibesComposer that imports from GitHub/ZIP or inline code, then creates a post plus optional capsule.
- `/post/:id` – Report posts render inline; app posts redirect to `/player/:id` for full runtime controls.
- `/player/:postId` – Full-screen player with sandboxed iframe, param controls, console/log streaming, report/share/remix hooks, and runtime budget enforcement.
- `/vibe/:capsuleId/remixes` – Remix family tree view for a capsule (origin, parents, and descendants).
- `/studio/*` – Experimental Studio shell (Import/Params/Files/Publish tabs). Not linked in nav; reachable via direct URL or `?capsuleId=` hydrate for existing drafts.
- `/u/:handle` (`/profile/:handle` redirects) – Profile header + blocks/themes + post list; profile data stored under `profiles`/`profile_*` tables keyed by `user_id`.
- `/settings`, `/settings/profile` – Account + profile editing surfaces (plan usage UI is static; Worker exposes `/user/quota`).
- `/pricing` – Plan details (Free, Creator, Pro, Team).
- `/live` – Live capsules placeholder/waitlist surface.
- `/report/new` – Report composer placeholder.
- Moderation/admin – `/moderation/flagged`, `/moderation/audit`, `/admin/moderation` (queue), `/admin/analytics` (runtime analytics dashboard for admins).
- Auth – `/sign-in`, `/sign-up` (Clerk).

## API (Cloudflare Worker, workers/api)
Full list in `workers/api/src/routes.ts`; highlights:

- **Manifest, import, artifacts**
  - `POST /manifest/validate` – validate manifest JSON.
  - `POST /import/github`, `POST /import/zip` – create capsule drafts from GitHub or uploaded ZIP (NDJSON progress optional via `?progress=1`).
  - Artifacts: `POST /artifacts` (create upload session), `PUT /artifacts/:id/sources`, `PUT /artifacts/:id/complete`, `GET /artifacts/:id/manifest`, `GET /artifacts/:id/bundle` (runtime bundle + manifest).

- **Capsules & Studio**
  - `POST /capsules/publish` – validate bundle, enforce plan quotas, run safety checks, upload to R2, create capsule + asset rows.
  - `GET /capsules/mine` – list capsules owned by caller.
  - `GET /capsules/:id`, `/verify`, `/manifest`, `/bundle` – capsule details, integrity check, runtime manifest, iframe entry.
  - `GET /capsules/:id/files-summary`, `GET|PUT /capsules/:id/files/:path`, `PATCH /capsules/:id/manifest` – draft hydration/editing for Studio.
  - `POST /capsules/:id/compile-draft`, `POST /capsules/:id/publish` – runtime artifact compilation + publish for drafts.

- **Profiles, follows, quota**
  - `POST /users/sync` – Clerk identity upsert; `GET /users/:handle`, `/posts`, `/check-following` – profile header + recent posts + follow status.
  - Extended profile: `GET /profile/:handle`, `PATCH /profile` (profile blocks/themes/layout), `GET /profile/search` (by tags/handle/name).
  - Follows: `POST /users/:id/follow`, `DELETE /users/:id/follow`, followers/following lists.
  - `GET /user/quota` – current plan + storage/run usage.

- **Posts, feed, social**
  - `GET /posts` – feed (modes latest|following|foryou, optional `q`, `tags`, pagination); `GET /posts/discover` – tag-focused lane.
  - `GET /posts/:id` – single post (app posts carry capsule + manifest for Player).
  - `POST /posts` – create post (app or report); `POST /covers` – upload cover images.
  - Likes: `POST /posts/:id/like`, `DELETE /posts/:id/like`, `GET /posts/:id/likes`, `GET /posts/:id/check-liked`.
  - Comments: `POST /posts/:id/comments`, `GET /posts/:id/comments`, `DELETE /comments/:id`.

- **Notifications**
  - `GET /notifications`, `GET /notifications/summary`, `GET /notifications/unread-count`, `POST /notifications/mark-read`.

- **Runtime + analytics**
  - `POST /runs/start` – reserve runtime slot + record started run; `POST /runs/complete` – finalize run and increment counters; `POST /runs/:id/logs` – append sampled console logs to Analytics Engine.
  - `POST /runtime-events` – ingest runtime telemetry into D1 (`runtime_events`) + Analytics Engine; `GET /runtime-analytics/summary` – admin-only snapshot for `/admin/analytics`.
  - Durable Objects: `GET /do/status` proxy into BuildCoordinator for health.

- **Moderation & safety**
  - Reports/queues: `POST /moderation/report`, `GET /moderation/reports`, `POST /moderation/reports/:id/resolve`, `GET /moderation/flagged-posts`, `GET /moderation/audit`.
  - Actions: `POST /moderation/posts/:id/action`, `POST /moderation/comments/:id/action`, `GET /moderation/posts/:id/status`.
  - Helpers: `POST /moderation/filter-content` (keyword filter), `POST /live/waitlist` (live capsule waitlist + analytics), safety gates on publish/import handled in handlers.

- **Embeds & proxy**
  - `GET /oembed` (for `/player/:id` and `/e/:id`), `GET /e/:id` (embed wrapper), `GET /og-image/:id` (SVG OG image), `GET /proxy` (allowlisted, authenticated network proxy with per-capsule/host rate limits).

## Data model (D1, `workers/api/src/schema.ts`)
- Identity & counters: `users` (plan, storage usage, denormalized counts, feature flags).
- Capsules/runtime: `capsules`, `assets`, `artifacts`, `artifact_manifests`, `runs`, `remixes`, `likes`.
- Content: `posts`, `comments`, `reports`, `follows`, `live_waitlist`.
- Profiles: `profiles`, `profile_themes`, `profile_blocks`, `custom_fields`, `projects`, `profile_links`, `badges`, `user_badges`, `handle_history`.
- Runtime analytics: `runtime_events` table expected by `/runtime-events` (Analytics Engine also receives telemetry).
