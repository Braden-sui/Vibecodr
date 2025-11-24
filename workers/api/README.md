# workers/api – Cloudflare Worker API

This Worker powers the Vibecodr SPA. All routes are registered in `src/routes.ts`, handlers live in `src/handlers/*`, and `src/index.ts` simply dispatches (with an optional `/api` prefix stripped for compatibility).

## Surface area
- **Manifest, import, artifacts**
  - `POST /manifest/validate` – manifest validation with structured errors/warnings.
  - `POST /import/github` (also accepts `/capsules/import/github`), `POST /import/zip` – create capsule drafts from GitHub archives or uploaded ZIPs; supports NDJSON progress streaming when `?progress=1`.
  - Artifacts pipeline: `POST /artifacts` → `PUT /artifacts/:id/sources` → `PUT /artifacts/:id/complete` → `GET /artifacts/:id/manifest` or `/bundle` for runtime bundles produced by the ArtifactCompiler DO.

- **Capsules & Studio**
  - `POST /capsules/publish` – validate bundle, enforce plan/storage quotas, run safety checks, upload to R2, write capsule + asset rows, and emit analytics.
  - `GET /capsules/mine` – list capsules owned by the caller.
  - `GET /capsules/:id`, `/verify`, `/manifest`, `/bundle` – capsule metadata, integrity check, runtime manifest, iframe entry bundle.
  - Draft editing: `GET /capsules/:id/files-summary`, `GET|PUT /capsules/:id/files/:path`, `PATCH /capsules/:id/manifest`.
  - Draft compilation/publish: `POST /capsules/:id/compile-draft`, `POST /capsules/:id/publish` (publishes a compiled draft artifact).

- **Profiles, follows, quota**
  - `POST /users/sync` – Clerk identity upsert (handle/name/avatar/bio/plan).
  - `GET /users/:handle`, `/posts`, `/check-following` – profile header + posts + follow status.
  - Extended profile management: `GET /profile/:handle`, `PATCH /profile`, `GET /profile/search`.
  - Follows: `POST /users/:id/follow`, `DELETE /users/:id/follow`, `GET /users/:id/followers`, `GET /users/:id/following`.
  - `GET /user/quota` – caller’s plan + storage/run usage snapshot.

- **Posts, feed, social**
  - `GET /posts` – feed with modes latest|following|foryou (optional `q`, `tags`, pagination); `GET /posts/discover` – tag-focused discover lane.
  - `GET /posts/:id` – single post payload (apps include capsule + manifest for Player).
  - `POST /posts` – create app or report posts; `POST /covers` – upload cover images.
  - Likes: `POST /posts/:id/like`, `DELETE /posts/:id/like`, `GET /posts/:id/likes`, `GET /posts/:id/check-liked`.
  - Comments: `POST /posts/:id/comments`, `GET /posts/:id/comments`, `DELETE /comments/:id`.

- **Notifications**
  - `GET /notifications`, `GET /notifications/summary`, `GET /notifications/unread-count`, `POST /notifications/mark-read`.

- **Runtime, runs, analytics**
  - `POST /runs/start` – reserve a runtime slot, enforce per-user concurrency and session limits, and return a run id.
  - `POST /runs/complete` – finalize runs, update counters, and emit analytics (includes failure states).
  - `POST /runs/:id/logs` – append sampled console logs to Analytics Engine for a run (auth + ownership enforced).
  - `POST /runtime-events` – ingest runtime telemetry into D1 (`runtime_events`) and Analytics Engine.
  - `GET /runtime-analytics/summary` – admin-only snapshot used by `/admin/analytics` in the SPA.
  - `GET /do/status` – proxy to the BuildCoordinator DO for health/metrics.

- **Moderation & safety**
  - Reports/queues: `POST /moderation/report`, `GET /moderation/reports`, `POST /moderation/reports/:id/resolve`, `GET /moderation/flagged-posts`, `GET /moderation/audit`.
  - Actions: `POST /moderation/posts/:id/action`, `POST /moderation/comments/:id/action`, `GET /moderation/posts/:id/status`.
  - Content helper: `POST /moderation/filter-content`.
  - Live waitlist: `POST /live/waitlist` (records session/email/handle + plan, emits analytics).

- **Embeds & proxy**
  - `GET /oembed` (for `/player/:id` + `/e/:id`), `GET /e/:id` (iframe wrapper), `GET /og-image/:id` (SVG OG image).
  - `GET /proxy?url=&capsuleId=` – authenticated allowlisted proxy; enforces manifest ownership, strips unsafe headers, and rate-limits per plan/host/ip (D1 table `proxy_rate_limits` + in-memory fallback).

## Infra notes
- D1 schema source of truth: `src/schema.ts` (Drizzle) with generated `src/schema.sql`. Apply via `pnpm d1:apply:local` / `pnpm d1:apply:remote`.
- R2 stores immutable capsule bundles keyed by content hash (`capsules/{hash}/`).
- Durable Objects: `BuildCoordinator` (build queue/status) and `ArtifactCompiler` (runtime artifact builds + analytics).
- Analytics Engine: emits import/publish/run/runtime/proxy/live events; see `src/handlers/*` and `durable/ArtifactCompiler.ts` for blob/double/index schemas.
- Auth: JWT verification via Clerk (`CLERK_JWT_ISSUER` + optional `CLERK_JWT_AUDIENCE`). Write endpoints use `requireAuth`/`requireUser`; moderation/admin routes gate on `isModeratorOrAdmin`/`requireAdmin`.
