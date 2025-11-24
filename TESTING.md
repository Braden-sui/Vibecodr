# Testing

Tooling: pnpm workspace with Turbo, Vitest for unit/component tests, and Playwright for E2E/performance. All commands assume pnpm 9+ from the repo root.

## Quick commands
- `pnpm test` – runs `test:unit` via Turbo (packages/shared, workers/api) then `test:component` in `apps/web`.
- `pnpm test:unit` – `turbo run test:unit` (Vitest) across packages that define `test:unit`.
- `pnpm test:component` – `pnpm test:component -w apps/web` (Vitest component/unit suites).
- `pnpm test:e2e` / `pnpm test:e2e:ui` – Playwright suites in `e2e/` (UI mode optional).
- `pnpm test:performance` – Playwright performance spec (`e2e/performance.spec.ts`).
- `pnpm test:coverage` – `turbo run test:coverage` for packages with coverage scripts (apps/web, packages/shared).

## Suites by area
- **workers/api (Vitest unit)** – Auth guards, feed pagination/visibility, capsules safety + rate limits, import pipeline, runtime artifact compilation, proxy allowlist/rate limiting, runs/logging/quarantine, moderation audit/status, runtime events, maintenance counters. Key files live under `workers/api/src/**/*test.ts`.
- **packages/shared (Vitest unit)** – Manifest validation, plans/quotas helpers, API contracts (`packages/shared/src/**/*.test.ts`).
- **apps/web (Vitest unit/component)** – Runtime/security headers, analytics helper, manifest parsing, runtime manifest loader, SEO helpers, user sync, Player runtime budgets, public runtime asset checks (`apps/web/**/*.test.ts`).
- **workers/api integration (Vitest)** – `workers/api/test/integration/*.test.ts` hit a running Worker at `http://127.0.0.1:8787`. Start the Worker first (`pnpm --filter vibecodr-api dev`) and set `WORKER_API_BASE` if different.
- **E2E (Playwright)** – `e2e/*.spec.ts` covers feed, studio/composer, player, profile, and performance. `playwright.config.ts` starts the web app via `npm run dev:web` (alias `pnpm dev:web`) on port 3000; ensure the Worker API is running locally (default `http://127.0.0.1:8787`) or set `WORKER_API_BASE` for the SPA before running.

## Notes
- Use `pnpm --filter vibecodr-api dev` alongside `pnpm --filter apps/web dev` when running E2E or integration tests so the SPA talks to a live Worker.
- Turbo tasks inherit `.env.*local`; keep API base env vars aligned between the SPA and Worker when debugging failures.
