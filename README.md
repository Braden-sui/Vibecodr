# Vibecodr – Runnable Feed Skeleton

This repository contains a minimal, navigable skeleton for the Vibecodr MVP:

- apps/web – Next.js app router UI with pages for Feed, Player, Studio, Profile, etc. All files contain explicit TODOs.
- apps/web/app/live – Phase 5 live capsules hub with waitlist gating and sample sessions.
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

