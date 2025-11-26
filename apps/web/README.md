# apps/web - UI Skeleton

This package hosts the front-end SPA built with Vite and React Router:

- `app/**` - Page modules kept for organization; all are `"use client"` React components consumed by the SPA (no Next.js runtime).
- `src/**` - SPA entry point (`src/main.tsx` + `App.tsx`) that renders `<BrowserRouter>` + `<AppRoutes />`.
- `components/**` - Shared UI primitives (shadcn, Player, Moderation/Admin UI).

## Architecture

- All feature pages live under `app/(site)` as `"use client"` components rendered via `react-router-dom`; there is no Next.js server runtime.
- The SPA harness (`src/App.tsx`) wraps everything in Clerk + PostHog providers, syncs the user on mount, and renders `<BrowserRouter>` + `<AppRoutes />` so feed, player, and composer share one path.
- API calls are centralized in `lib/api.ts`/`lib/worker-api.ts`, which resolve the Worker base URL in order: `WORKER_API_BASE`, `NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_API_URL`, falling back to `http://127.0.0.1:8787` in dev.

## Key routes

- `/` – feed tabs (latest/following/foryou), search (`?q=`) + tag filters (`?tags=`), inline run actions that obey runtime budgets.
- `/discover` – tag-focused discover lane backed by `/posts/discover`.
- `/post/new` (alias `/composer`) – unified composer using `VibesComposer` with a bounded app attach flow (GitHub/ZIP/inline) before posting.
- `/post/:id` – non-app vibes render inline; app vibes redirect to `/player/:id`.
- `/player/:postId` – sandboxed runner with param controls, console/log streaming, remix/share/report actions, runtime slot reservation.
- `/studio/*` – experimental Studio shell (Import/Params/Files/Publish) available via direct URL or `?capsuleId=` hydrate.
- `/u/:handle` (`/profile/:handle` redirects) – profile header + blocks/layout + post list.
- `/settings`, `/settings/profile` – plan usage (static) + profile editing.
- `/pricing`, `/live`, `/report/new` – marketing/static and placeholders (report/new reserved for longform editor).
- Moderation/admin – `/moderation/flagged`, `/moderation/audit`, `/admin/moderation` (queue), `/admin/analytics` (runtime analytics dashboard).
- Auth – `/sign-in`, `/sign-up`.

## Development commands

- `pnpm --filter apps/web dev` - Launches the Vite dev server on `localhost:3000` with hot reloading. Use this for everyday UI/UX work and Vitest suites.
- `pnpm --filter vibecodr-web run build` - Produces the static assets under `apps/web/dist`.

## Implementation checklist

- Data fetching: wire to Workers API endpoints
- Styling: Tailwind + shadcn (tokens, components)
- Auth: Clerk (`VITE_CLERK_PUBLISHABLE_KEY`) with `useAuth().getToken({ template: "workers" })` for privileged fetches
- Analytics: PostHog client wrapper plus Worker runtime event/log hooks for Player interactions
- Accessibility: focus traps in Player, keyboard navigation
