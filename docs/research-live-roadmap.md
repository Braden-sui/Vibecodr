# Research: Live Streaming (Defer for MVP)

## Overview
Live is compelling but cost-sensitive. Keep UX mentions and waitlist, do not ship infra until userbase warrants.

## Options (Later)
- Daily SDK (P2P rooms or SFU): predictable participant-minute pricing; simple web API.
- LiveKit (self-host or cloud): powerful SFU; more ops overhead self-hosted.
- Cloudflare Stream/Mux: VOD storage + playback with chapter markers.

## UX Notes
- “Go Live” button gated behind plan; when disabled, show “Coming Soon” + notify me.
- During live: pointer laser, param timestamping, questions anchored to app state.
- After: save VOD with chapters (from param changes).

## Implementation (When Enabled)
- Room server: Durable Object or hosted provider room API.
- Presence in Player: viewers, chat, follow presenter state or decouple.
- Recording → VOD pipeline with shareable chapters.

## Sources
- Daily pricing/SDK: https://www.daily.co/pricing/
- Cloudflare Stream: https://www.cloudflare.com/products/cloudflare-stream/
- Mux video: https://www.mux.com/pricing/video

