# workers/api – Cloudflare Worker API Skeleton

This Worker powers the Vibecodr UI at `/api/*`. Most endpoints are implemented and wired to D1/R2; see `src/index.ts` and `src/handlers/*` for full details.

High-level surface area:

- **Manifest & capsules**
  - `POST /manifest/validate` – validate manifest JSON and return structured errors/warnings.
  - `POST /capsules/publish` – validate manifest, enforce plan bundle/storage limits, upload bundle to R2, create capsule + assets rows.
  - `GET /capsules/:id`, `GET /capsules/:id/verify`, `GET /capsules/:id/manifest`, `GET /capsules/:id/bundle` – capsule metadata, integrity checks, manifest, and entry bundle for the Player/Feed.

- **Import pipeline**
  - `POST /import/github` – download a GitHub repo archive, analyze, (stub) bundle via esbuild-wasm, generate manifest, and upload as a capsule.
  - `POST /import/zip` – accept ZIP upload, analyze contents, generate manifest, and upload as a capsule.

- **Feed, posts, and runs**
  - `GET /posts?mode=latest|following|foryou&q=&tags=` – feed backing the homepage lanes.
  - `GET /posts/:id` – single post payload used by the Player.
  - `POST /posts` – create App or Report posts (validated via Zod schema).
  - `POST /runs/complete` – minimal run logging endpoint (capsuleId/postId, duration, status).
  - `POST /runs/:id/logs` – append logs from runner (currently a stub that returns 501 with a TODO payload).

- **Social + profiles**
  - Likes: `POST /posts/:id/like`, `DELETE /posts/:id/like`, `GET /posts/:id/likes`.
  - Comments: `POST /posts/:id/comments`, `GET /posts/:id/comments`, `DELETE /comments/:id`.
  - Follows: `POST /users/:id/follow`, `DELETE /users/:id/follow`, followers/following listing, and `GET /users/:id/check-following`.
  - Profiles: `POST /users/sync`, `GET /users/:handle`, `GET /users/:handle/posts`.

- **Notifications**
  - `GET /notifications`, `GET /notifications/summary`, `GET /notifications/unread-count`, `POST /notifications/mark-read`.

- **Moderation & safety**
  - User reports: `POST /moderation/report`.
  - Queues & audit: `GET /moderation/flagged-posts`, `GET /moderation/reports`, `POST /moderation/reports/:id/resolve`, `GET /moderation/audit`.
  - Direct actions: `POST /moderation/posts/:id/action`, `POST /moderation/comments/:id/action`.
  - Content filter helper: `POST /moderation/filter-content`.

- **Embeds & proxy**
  - `GET /oembed` – oEmbed JSON for `/player/:id` and `/e/:id`.
  - `GET /e/:id` – static iframe wrapper for embedding the Player.
  - `GET /og-image/:id` – branded SVG Open Graph image.
  - `GET /proxy?url=…&capsuleId=…` – authenticated, allowlisted network proxy that only honors manifests for capsules owned by the caller, with per-capsule/host rate limiting and cookie stripping.

Infra notes:
- D1 schema lives in `src/schema.sql` and `src/schema.ts` (Drizzle model + Zod contracts). Apply via wrangler migrations or Drizzle once ready.
- R2 stores immutable capsule bundles keyed by content hash (`capsules/{hash}/…`).
- Durable Objects (`BuildCoordinator`) can coordinate build queues and expose `/do/status`.
- Workers Analytics Engine is wired for simple probes (see `doStatus`).
- Auth requires `CLERK_JWT_ISSUER` (and optional `CLERK_JWT_AUDIENCE`) so the Worker can verify Clerk-issued JWTs via their JWKS. Write endpoints use `requireAuth` / `requireUser`, and moderator/admin routes gate on `isModeratorOrAdmin` / `requireAdmin`.

Open TODOs:
- Complete per-endpoint quotas (import/build, runs, heavy routes) and align with documented plan limits.
- Add WAF/Cloudflare-level rate limits for public read endpoints and heavy write endpoints.
- Expand structured logging and error codes across all handlers (see `docs/api-safety-and-abuse-invariants.mdx`).

## Users schema notes
- users.id equals Clerk user.id (string)
- plan: one of free | creator | pro | team; defaults to free
- followers_count/following_count/posts_count/runs_count/remixes_count: denormalized counters (integers)
- primary_tags: JSON array string of preferred tags (nullable)
- is_featured/is_suspended/shadow_banned: boolean-like flags (0/1)
