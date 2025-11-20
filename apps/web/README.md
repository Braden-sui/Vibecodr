# apps/web - UI Skeleton

This package hosts the front-end SPA:

- `app/**` - Route modules and styles organized under the legacy Next directory structure. These files are all `"use client"` components that import `react-router-dom` hooks and are consumed by the SPA.
- `src/**` - The Vite SPA entry point (`src/main.tsx` + `App.tsx`) that renders the UI via `<BrowserRouter>` and `<AppRoutes />`.
- `components/**` - Shared UI primitives (shadcn, Player, Moderation UI). Route modules import these directly.

## Architecture

- Every user-facing page under `app/(site)` is a `"use client"` component built with `react-router-dom` hooks.
- The SPA harness (`src/App.tsx`) renders `<BrowserRouter>` + `<AppRoutes />`, so Feed, Player, Studio, etc., only have one implementation path.
- API calls are centralized in `lib/api.ts`, which reads `getWorkerApiBase()` so the SPA always talks directly to the Worker.

## Key routes

- `/` (Feed): cards, hover previews, actions
- `/player/[postId]`: sandboxed runner, params drawer, logs, remix
- `/studio`: import/build pipeline UI
- `/post/[id]`: app/report display
- `/report/new`: report composer placeholder with snapshot button
- `/profile/[handle]`: profile + posts
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
