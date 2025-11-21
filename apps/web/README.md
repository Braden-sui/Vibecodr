# apps/web - UI Skeleton

This package hosts the front-end SPA built with Vite and React Router:

- `app/**` - Page modules kept for organization; all are `"use client"` React components consumed by the SPA (no Next.js runtime).
- `src/**` - SPA entry point (`src/main.tsx` + `App.tsx`) that renders `<BrowserRouter>` + `<AppRoutes />`.
- `components/**` - Shared UI primitives (shadcn, Player, Moderation UI).

## Architecture

- Every user-facing page under `app/(site)` is a `"use client"` component built on `react-router-dom`; there is no Next.js rendering path.
- The SPA harness (`src/App.tsx`) renders `<BrowserRouter>` + `<AppRoutes />`, so Feed, Player, and the composer all share one implementation path.
- API calls are centralized in `lib/api.ts`, which reads `getWorkerApiBase()` so the SPA always talks directly to the Worker.

## Key routes

- `/` (Feed): cards, hover previews, actions
- `/player/:postId`: sandboxed runner, params drawer, logs, remix
- `/post/new`: unified composer for posts/imports/inline code (old `/studio` now redirects here)
- `/post/:id`: app/report display
- `/report/new`: report composer placeholder with snapshot button
- `/u/:handle`: public profile + blocks/layout
- `/settings`: plan usage and upgrades UI (static; no billing wiring yet)
- `/admin/moderation`: moderation queue

## Development commands

- `pnpm --filter apps/web dev` - Launches the Vite dev server on `localhost:3000` with hot reloading. Use this for everyday UI/UX work and Vitest suites.
- `pnpm --filter vibecodr-web run build` - Produces the static assets under `apps/web/dist`.

## Implementation checklist

- Data fetching: wire to Workers API endpoints
- Styling: Tailwind + shadcn (tokens, components)
- Auth: Clerk/Lucia (GitHub + Google)
- Analytics: Cloudflare Analytics Engine datapoints for Player interactions
- Accessibility: focus traps in Player, keyboard navigation
