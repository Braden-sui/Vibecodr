# Vibecodr – Runnable Feed Skeleton

This repository contains a minimal, navigable skeleton for the Vibecodr MVP:

- apps/web – Next.js app router UI with pages for Feed, Player, Studio, Profile, etc. All files contain explicit TODOs.
- apps/web/app/live – Phase 5 live capsules hub for project showcase streams (demos, walkthroughs, or coding) with waitlist gating and sample sessions.
- workers/api – Cloudflare Worker API skeleton with route stubs and D1 schema.
- docs – Research and MVP planning documents.
- docs/phase-5-plan.md – Expansion & activation plan for post-MVP capabilities.
- SITEMAP.md – Quick overview of routes and API edges.

## Phase 5 Snapshot

- Feed now supports search, tag filters, and a For You lane with analytics events.
- Live Capsules page provides waitlist onboarding plus sample session cards.
- Shared manifest schema understands worker-edge runners, live settings, and concurrency caps.

Next steps:
- Wire the live waitlist form to the Workers API.
- Connect feed search/filter params to the backend query once endpoints land.

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
