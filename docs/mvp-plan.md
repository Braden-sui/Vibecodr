# Vibecodr Runnable Feed – MVP Plan

## Product North Star
A social timeline where every card is a runnable micro-app (“capsule”) you can click, run, tweak, and remix in seconds. The first release must prove that interactive showcasing is safe, fast, and fun before we expand into heavier collaboration features.

## Core Jobs To Be Done
- **Show off** – post a tiny app, get instant runs, comments, and remixes.
- **Learn by doing** – open any post, adjust exposed params, watch the state change live.
- **Collaborate lightly** – leave notes, fork the capsule to your studio, share a quick report.
- **Tell the story** – attach maker notes or reports that capture why the app matters.

## Surfaces & UX Notes
### Feed
- Card types: **App** and **Report** at MVP (Live appears as “Coming Soon” badge only).
- Hover previews auto-boot an isolated capsule; click opens the Player modal.
- Each card shows runtime badges (runner, net access, params count) and a Remix chip.

### Player
- Left pane: sandboxed iframe that bootstraps the capsule manifest.
- Right drawer tabs:
  - **Notes** – author commentary, param presets, version history.
  - **Remix** – diff summary + “Fork to Studio” CTA.
  - **Chat** – lightweight comments (threading optional post-MVP).
- Bottom bar: restart, performance meter, exposed params, share, report.

### Studio
- Tabs: Import → Params → Files → Publish.
- Import adapters at launch: GitHub repo/branch, ZIP upload, “static export from v0/create.xyz”. Bubble stays as “Embed only.”
- Params tab defines sliders/toggles surfaced in the Player.
- Files tab offers simple edits (entry file, assets, manifest.json) with validation.
- Publish tab: title, tags, cover, visibility, capability prompts, dry-run check.

## Capsule Constraints (App Size & Safety)
- **Bundle cap**: 25 MB total assets per capsule for free/creator tiers; 100 MB for Pro; 250 MB for Team (enforced via manifest validation and R2 object size).
- **Entry requirements**: static HTML/JS/CSS bundle (`runner: client-static`) for MVP. Optional WebContainer runner stays behind a flag until performance budgets are proven.
- **Resource guardrails**: iframe sandbox with `sandbox`, strict CSP, no network unless allowlisted via manifest (`capabilities.net`). CPU timeouts (5 s boot, 60 s run) and memory checks via the runner shim.

## Pricing & Usage Caps (Cloudflare economics)
| Plan   | Price | Runs/mo | Storage cap | Included live minutes* |
| ------ | ----: | ------: | ----------: | ----------------------: |
| Free   | $0    | 5 k     | 1 GB        | 0 (watch only)          |
| Creator| $9    | 50 k    | 10 GB       | 0                       |
| Pro    | $29   | 250 k   | 50 GB       | 2 500                   |
| Team   | $99   | 1 M     | 250 GB      | 10 000                  |
\*Live streaming feature is advertised as “upcoming”; minutes will activate when the feature ships to avoid premature hosting costs.

Per-run COGS on Cloudflare (Workers + R2) stay under $0.0003, so gross margins remain healthy even at capped usage. Overage pricing mirrors Cloudflare/Daily list rates with a 20% markup.

## Architecture – Cloudflare-First
| Concern | Service | Notes |
| ------- | ------- | ----- |
| Web app & API | Cloudflare Pages + Workers | Next.js frontend built for Pages; API routes land in Workers for global low-latency. |
| Data | Cloudflare D1 | Holds users, posts, capsules, runs, comments, follows, remixes. Use Drizzle or Kysely for migrations + query safety. |
| Assets & Capsules | Cloudflare R2 | Store immutable capsule bundles keyed by content hash; zero-egress feeds Player & Feed previews cheaply. |
| Realtime presence | Durable Objects | Track who’s viewing/remixing a capsule; global singleton per capsule for param sync. |
| Queue / build throttle | Durable Object “BuildCoordinator” | Serializes heavy ZIP/GitHub imports, captures logs, emits status events. |
| Auth | Clerk or Lucia + Workers | GitHub + Google OAuth; Clerk offers native Workers support and UI components. |
| Observability | Workers Analytics Engine + PostHog | Capture run metrics, param usage, errors. |
| Video (future) | Daily SDK | Mentioned in roadmap only; no infrastructure deployed until activation milestone. |

### Non-goals for MVP
- Edge worker runner (server-side code) – phase 2.
- Full-text search cluster – use Postgres FTS later.
- Live streaming infra – only UX placeholder badge and waitlist CTA; no Daily rooms spun up yet.

## Implementation Phases & Deliverables
### Phase 1 (Days 0–10): Foundation
1. Bootstrap Next.js (app router) with Tailwind, shadcn, Lucide.
2. Set up Workers + Pages deployment pipeline; wire Clerk auth.
3. Define D1 schema (users, capsules, posts, assets, runs).
4. Build card grid Feed using mock capsule data.
5. Player shell loads a hardcoded capsule from R2 and enforces sandbox flags.

### Phase 2 (Days 11–25): Capsules & Studio
1. Manifest schema + validator (`/api/manifest/validate`).
2. Client-static runner service worker + iframe bridge (params, console proxy, restart).
3. Studio Import pipeline (GitHub + ZIP) → static build via esbuild-wasm, bundle to R2, manifest emit.
4. Params designer UI with live preview.
5. Publish flow that mints immutable capsule + Feed post.

### Phase 3 (Days 26–35): Social Layer
1. Feed sorting (latest, following) + basic profile pages.
2. Comments + lightweight notifications.
3. Remix graph chip: track parent/child capsule IDs.
4. Report posts with inline app snapshots (stored param presets).

### Phase 4 (Days 36–45): Safety & Polish
1. Network allowlist proxy, CSP tightening, kill switch UI.
2. Run quotas + plan enforcement middleware.
3. Moderation queue (reports, quarantine flag).
4. Share cards + external embed snippet.

### Parking Lot (Post-MVP)
- Live streaming + co-view presence (requires Daily infra, pointer sync, VOD storage). Keep UX mentions (“Live demo coming soon”) but block creation until userbase justifies cost.
- WebContainer runner for Node-based demos.
- Worker-edge runner for per-app server logic.
- Full collaborative editing, inline annotations.

## Next Actions
1. Stand up the Cloudflare stack skeleton (Pages + Workers + D1) and commit initial schema.
2. Implement manifest validator + sample capsule gallery to dogfood the Player.
3. Ship plan-based quotas + dashboards so we can monitor costs before unlocking Live.

This plan keeps the MVP lean, Cloudflare-optimized, and ready to showcase runnable experiences while clearly signaling (but deferring) the pricier live feature.
