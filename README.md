# Vibecodr – Runnable Feed Skeleton

This repository contains a minimal, navigable skeleton for the Vibecodr MVP:

- apps/web – Next.js app router UI with pages for Feed, Player, Studio, Profile, etc. All files contain explicit TODOs.
- workers/api – Cloudflare Worker API skeleton with route stubs and D1 schema.
- docs – Research and MVP planning documents.
- SITEMAP.md – Quick overview of routes and API edges.

Next steps:
- Pick styling stack (Tailwind + shadcn) and wire providers (auth, analytics).
- Implement Worker endpoints incrementally (import → publish → manifest → posts).
- Hook the web app to the API; replace mock data with real queries.

