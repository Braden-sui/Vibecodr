# Local Development

This repo ships a single React Router SPA in `apps/web/src`. The `"use client"` page modules still live under `apps/web/app/(site)` for organizational parity, but everything renders through the Vite entry point. Every browser call hits the Cloudflare Worker API (`workers/api`) directly via helpers in `apps/web/lib/api.ts`.

## Prerequisites

- Node.js 20+
- `pnpm` 9.x (see `packageManager` in `package.json`)
- `wrangler` (installed automatically via `pnpm`, but a global install is handy for D1/R2 auth)

## Environment Variables

| File | Purpose | Required keys |
| ---- | ------- | ------------- |
| `.env.local` (repo root) | Worker secrets + database bindings | `CLERK_*`, `ALLOWLIST_HOSTS`, `D1_DATABASE_ID`, `R2_*`, etc. |
| `apps/web/.env.local` | Shared by Vite dev server, Vitest, and build | `NEXT_PUBLIC_CLERK_*`, `WORKER_API_BASE`, and/or `NEXT_PUBLIC_API_BASE` |

For local API development set:

```ini
# apps/web/.env.local
WORKER_API_BASE=http://127.0.0.1:8787
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8787
```

The proxy helper (`getWorkerApiBase`) reads `WORKER_API_BASE`, `NEXT_PUBLIC_API_BASE`, and `NEXT_PUBLIC_API_URL` in that order, falling back to `http://127.0.0.1:8787` when `NODE_ENV=development`.

## Running Everything Locally

1. Install dependencies once:

   ```bash
   pnpm install
   ```

2. In one terminal, start the Worker API:

   ```bash
   pnpm --filter workers/api dev
   ```

   Wrangler will bind to `http://127.0.0.1:8787` by default. Add `--persist` (or the `--local` flags above) if you want to reuse a D1 state file between runs.

3. In a second terminal, start the web app:

   ```bash
   pnpm --filter apps/web dev
   ```

   This command launches the Vite dev server on `http://localhost:3000`. Alternatively, run `pnpm dev` from the repo root to let Turbo spawn both `apps/web` (Vite) and `workers/api` concurrently.

## Notes

- To target your production Worker from local dev, set `WORKER_API_BASE=https://<your-worker>.workers.dev` in `apps/web/.env.local`. All SPA fetches will point there automatically.
- The SPA calls `workerUrl(...)` directly using the host you configured above. There is no `/api/*` proxy layer anymore, so browsers always talk straight to the Worker origin.
- The Studio publish workflow uploads bundles via `/api/capsules/publish`, so keep the Worker dev server running when testing publish/post creation flows.
- If you see `401 Unauthorized` responses during local dev, confirm you are signed into Clerk and that `WORKER_API_BASE` matches the host where you also configured your Clerk JWT issuer.
