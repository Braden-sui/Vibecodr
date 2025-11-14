# Vibecodr – Runnable Feed Skeleton

This repository contains a minimal, navigable skeleton for the Vibecodr MVP:

- apps/web – Next.js app router UI with pages for Feed, Player, Studio, Profile, etc. All files contain explicit TODOs.
- apps/web/app/live – Placeholder Phase 5 live capsules hub route; UI experiments for waitlist and sample sessions, no live infra or backend wiring yet.
- workers/api – Cloudflare Worker API backing feed, capsules, social, notifications, and moderation. Most endpoints are implemented; see `SITEMAP.md` and `workers/api/README.md`.
- docs – Research and MVP planning documents.
- docs/phase-5-plan.md – Expansion & activation plan for post-MVP capabilities.
- SITEMAP.md – Quick overview of routes and API edges.

## Phase 5 Snapshot

- Feed now supports search, tag filters, and a For You lane with analytics events.
- Live Capsules surfaces include a `/live` placeholder route and prototype live-session card + waitlist UI components; no streaming infra or Worker endpoints yet.
- Shared manifest schema understands worker-edge runners, live settings, and concurrency caps.

Next steps:
- Wire the live waitlist form to the Workers API.
- Refine feed search/filter behaviour and For You ranking now that the backend query and analytics wiring are in place.

## Cloudflare Pages build

We now ship with Next 15.5.2 running entirely on the Edge runtime so it can be adapted by `@cloudflare/next-on-pages`. The build workflow is:

```bash
pnpm run cf:build
```

The script performs the three steps the adapter expects:

1. Run `vercel build` inside `apps/web`.
2. Remove the generated Node-oriented `_not-found` serverless function (the route is pre-rendered in `/404.html`, so only the static asset is required).
3. Reuse that output via `@cloudflare/next-on-pages --skip-build` to produce the `_worker.js` bundle.

When the command completes you will find the worker bundle under `.vercel/output/static/_worker.js`.

## Local development

Run the Worker API and the Next.js app together so `/api/*` requests can proxy to your local Worker. Detailed setup steps, required environment variables, and troubleshooting notes live in [`docs/local-dev.md`](docs/local-dev.md).
