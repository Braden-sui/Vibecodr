# Vibecodr - Runnable Feed Skeleton

This repository contains a minimal, navigable skeleton for the Vibecodr MVP:

- apps/web - React Router SPA built with Vite. Route components live under `apps/web/app/(site)` for parity with the original Next skeleton, but everything now renders through the SPA entry in `apps/web/src`.
- apps/web/app/live - Placeholder Phase 5 live capsules hub route; UI experiments for waitlist and sample sessions, no live infra or backend wiring yet.
- workers/api - Cloudflare Worker API backing feed, capsules, social, notifications, and moderation. Most endpoints are implemented; see `SITEMAP.md` and `workers/api/README.md`.
- docs - Research and MVP planning documents.
- docs/phase-5-plan.md - Expansion & activation plan for post-MVP capabilities.
- SITEMAP.md - Quick overview of routes and API edges.

## Phase 5 Snapshot

- Feed now supports search, tag filters, and a For You lane with analytics events.
- Live Capsules surfaces include a `/live` placeholder route and prototype live-session card + waitlist UI components; no streaming infra or Worker endpoints yet.
- Shared manifest schema understands worker-edge runners, live settings, and concurrency caps.

Next steps:
- Wire the live waitlist form to the Workers API.
- Refine feed search/filter behaviour and For You ranking now that the backend query and analytics wiring are in place.

## UI architecture cheat sheet

- **Single-page client** - `apps/web/src/App.tsx` renders the entire UI via React Router. All feature routes live inside `AppRoutes`, which import the `"use client"` components stored under `apps/web/app/(site)` for reuse.
- **Clerk integration** - Components rely on `@clerk/clerk-react`. When privileged calls are needed, they request `useAuth().getToken({ template: "workers" })` and pass that bearer token directly to the Worker API.
- **Worker access** - `apps/web/lib/api.ts` centralizes all fetch calls through `getWorkerApiBase()`, so the SPA always talks to `https://<worker>/...` and never needs an intermediate `/api/*` proxy.
- **User sync** - `EnsureUserSynced` invokes `ensureUserSynced` on mount, which POSTs the normalized Clerk user profile to `${getWorkerApiBase()}/users/sync` one time per browser session.

## Web build

Use the Vite build to produce the static assets that Pages can deploy:

```bash
pnpm --filter vibecodr-web run build
```

Outputs land in `apps/web/dist`.

## Local development

Run the Worker API and the SPA together. During local dev every fetch goes straight to `${WORKER_API_BASE}` (defaulting to `http://127.0.0.1:8787`). Detailed setup steps, required environment variables, and troubleshooting notes live in [`docs/local-dev.md`](docs/local-dev.md).
