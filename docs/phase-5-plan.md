# Vibecodr Phase 5 – Expansion & Activation Plan

Phase 5 extends the initial four-phase MVP program by tackling the “Post-MVP Parking Lot” items in `docs/checklist.mdx` and translating learnings from the research library into an execution plan. The aim is to prove advanced runtimes, live collaboration, and growth loops without regressing the safety/perf guardrails that made the runnable feed viable.

## Objectives & Success Criteria

1. **Live Capsules & Presence** – ship a gated live streaming beta (Daily/LiveKit) for showcasing projects and demos with waitlist activation, pointer sync, and post-session VOD chapters while keeping infra spend predictable (`docs/research-live-roadmap.md`). Hosts can present their capsules, walk through features, or even stream their coding process with Claude Code/Codex if desired.
2. **Advanced Runtimes** – graduate WebContainer previews from flag to supported tier and stand up a worker-edge runner track for lightweight server logic, enforcing the bundle/cap limits defined in `docs/research-code-showcase-platforms.md` and `docs/checklist.mdx §18`.
3. **Discovery & Collaboration Loops** – add For You ranking, full-text search, richer embeds, and collaborative editing/annotations so remixes and shares compound (`docs/research-social-platforms.md`, `docs/research-embed-share-and-seo.md`).
4. **Observable Reliability** - deepen analytics (Cloudflare Analytics Engine dashboards + Workers Analytics Engine) and moderation tooling so the new capabilities stay safe (`docs/research-analytics-and-growth.md`, `docs/research-moderation-and-safety.md`, `docs/research-sandbox-and-runner.md`).

Early indicators of success:
- ≥10 live sessions/week with >70% completion and TTFF ≤1.5 s for webcontainer/live handoff.
- 25% of weekly posts use advanced capabilities (storage/live today; workers unlock alongside future premium VM tiers, and network access returns when those land) without exceeding quotas.
- Search + For You drive ≥30% of runs from non-followers; embed traffic converts ≥10% to Player opens.
- Incident response time <15 min and no Sev1 caused by new runtimes.

## Research Synthesis

- **Runner & Capsule Guardrails** – `docs/research-code-showcase-platforms.md` stresses fast client-static paths plus webcontainer as a heavier option; we must preserve bundle caps (25 MB/100 MB/250 MB) and manifest-driven capability badges when adding worker-edge support.
- **Live Experience Economics** – `docs/research-live-roadmap.md` recommends Daily/LiveKit with gated entry and VOD chapters; Phase 5 should keep “Coming Soon” UX but enable curated pilots.
- **Import & Storage** – `docs/research-github-import-storage.md` outlines caching immutable bundles in R2, esbuild-wasm fast paths, and license detection—prereqs for larger repos we expect once collaboration lands.
- **Safety & Moderation** – `docs/research-moderation-and-safety.md` + `docs/research-sandbox-and-runner.md` reaffirm sandbox/CSP defaults, proxy allowlists, kill switch UI, and reporting so expanded capabilities stay compliant.
- **Growth Surfaces** – `docs/research-social-platforms.md` and `docs/research-embed-share-and-seo.md` highlight For You feeds, remix-first CTAs, share cards, snapshot links, and oEmbed endpoints needed to turn Phase 5 launches into acquisition loops.
- **Analytics** – `docs/research-analytics-and-growth.md` provides the event taxonomy required to monitor TTFF, restarts, remixes, and quota usage before and after Phase 5 features hit GA.

## Pillars & Workstreams

### 1. Live Capsules & Presence
- Stand up Daily/LiveKit room broker (Durable Object) with plan gating and waitlist toggles for project showcase streams.
- Player live mode: pointer laser, param timeline, attendee list, fallback to VOD after session—hosts demonstrate their capsules, explain features, take Q&A.
- Recording/VOD pipeline with chapter markers derived from param change events for replay value.
- Cost guardrails: per-plan live minutes, alerts when 80% consumed, "notify me" for locked plans.

### 2. Advanced Runner Stack
- Move WebContainer preview out of feature flag: enforce 1.5 s P95 boot, concurrency caps, kill switch UI.
- Worker-edge runner alpha (future premium tier): allow tiny Workers per capsule for server logic, proxied through Cloudflare; align with manifest capability declarations once the runtime is provisioned.
- Manifest/schema updates for new capabilities (prep net scopes for future premium tiers, worker entrypoints, storage quotas); update `/api/manifest/validate`.
- GitHub import upgrades: repo analyzer for server code flags, SPDX detection, and build queue scaling (BuildCoordinator Durable Object).

### 3. Discovery, Collaboration & Sharing
- Feed ranking: add “For You” blend of recency + remix velocity; introduce lightweight interest models.
- Full-text search (Postgres/Neon or Cloudflare + Meilisearch) for posts/capsule metadata with plan-based quotas.
- Collaborative editing beta: shared cursor/comments in Studio, inline annotations on Player (leveraging Durable Objects presence).
- Sharing enhancements: OG image renderer V2, `embed.js` auto-theme + resize, oEmbed JSON endpoint, snapshot links that freeze param state for comments/shares.

### 4. Analytics, Moderation & Ops
- Expand analytics: Cloudflare Analytics Engine dashboards for live usage, runner mix, embed-driven runs; Workers Analytics Engine rollups for proxy/load metrics.
- Moderation queue V2: escalation states, quarantine workflow, staff audit logs, keyword filters tuned for live chat.
- Reliability tooling: incident runbook, synthetic TTFF tests for each runner type, alerts on live minute spikes or runner error rate.
- Plan + quota enforcement: integrate new capabilities into billing (live minutes, worker-edge CPU) with UI progress banners.

## Milestones (Target 8-Week Phase)

| Week | Focus | Key Deliverables |
| ---- | ----- | ---------------- |
| 1–2 | Foundation | Finalize Phase 5 design docs, update manifest schema, expand analytics events, staff approvals for Daily/LiveKit sandbox. |
| 3–4 | Runner + Live Alpha | WebContainer GA hardening, worker-edge sandbox prototype, live room broker + gated waitlist UI. |
| 5–6 | Collaboration & Discovery | For You ranking MVP, search index + API, Studio co-edit annotations, embed/oEmbed revamp. |
| 7 | Reliability & Moderation | Incident playbooks, moderation queue V2, quota dashboards for live minutes/worker CPU. |
| 8 | Beta Launch & Review | Pilot live sessions with curated creators, collect metrics, decide GA gates, backlog cut for Phase 6. |

## Implementation Log (Week 1 Kickoff)

- **Shared manifest** – `packages/shared/src/manifest.ts` schema now supports worker-edge runners, live session settings, and concurrency hints so capsules can declare new capabilities upfront.
- **Discovery surface** – `apps/web/app/(site)/page.tsx` + `HomePageClient` expose Latest/Following/For You modes with search + tag filters and route analytics events via `apps/web/lib/analytics.ts`.
- **Live beta UX** – `/live` currently renders a placeholder page; `LiveSessionCard` and `LiveWaitlistDialog` components exist as prototypes for a future live capsules hub and waitlist, but are not yet wired to streaming infra or Worker endpoints.

## Dependencies & Open Questions

- Legal review for updated Terms/Privacy covering live streaming & worker-edge execution.
- Billing integration for new plan metrics (live minutes, worker CPU) and updates to `docs/checklist.mdx §14`.
- Storage/compute budgeting for R2 + Daily minutes; need finance signoff.
- Decision on search backend (Cloudflare D1 FTS vs managed service) and acceptable latency.
- Live moderation tooling: do we need human in the loop or automated heuristics for chat/code during live?

## Risks & Mitigations

- **Cost spikes from live minutes** → enforce per-session caps, auto-disable after quota, surface alerts before hitting paid overages.
- **Runner instability** → synthetic tests per release, dark-launch worker-edge behind feature flags, kill switch accessible to ops.
- **Security exposure** → maintain strict sandbox/CSP, proxy host allowlists, audit manifest changes, run security review before GA.
- **UX complexity** → progressive disclosure: keep client-static path default, advanced runners opt-in with capability badges and education.
- **Team bandwidth** → parallelize by pillar, ensure BuildCoordinator + Durable Objects expertise allocated before live sprint.

## Immediate Next Steps

1. Socialize this plan with product/engineering leads; align on scope and 8-week timeline.
2. Create detailed RFCs for live capsules, worker-edge runner, and feed ranking/FTS.
3. Update backlog/Linear with workstream epics and connect to checklist section 18 items.
4. Kick off technical spikes (Daily integration, worker-edge prototype, search infra) and schedule Phase 5 readiness review.
