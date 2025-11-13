# workers/api – Cloudflare Worker API Skeleton

Endpoints (stubs return 501 until implemented):
- POST /import/zip → Create capsule draft from ZIP
- POST /capsules/:id/publish → Validate + publish immutable bundle
- GET /capsules/:id/manifest → Player fetches runtime manifest
- POST /runs/:id/logs → Append logs from runner
- POST /posts → Create App or Report post
- POST /moderation/report → Create moderation report
- GET /proxy?url=… → Allowlist network proxy

Infra notes:
- D1 schema lives in src/schema.sql (apply via wrangler migrations later)
- R2 stores immutable bundles keyed by content hash
- Durable Objects can be added later for build queue or presence

Open TODOs:
- Auth: validate user and enforce plan quotas
- Input validation and JSON schemas
- Rate limiting per IP/user/route
- Error handling and structured logs

## Users schema notes
- users.id equals Clerk user.id (string)
- plan: one of free | creator | pro | team; defaults to free
- followers_count/following_count/posts_count/runs_count/remixes_count: denormalized counters (integers)
- primary_tags: JSON array string of preferred tags (nullable)
- is_featured/is_suspended/shadow_banned: boolean-like flags (0/1)

