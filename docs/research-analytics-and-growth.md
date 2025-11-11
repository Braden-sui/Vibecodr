# Research: Analytics & Growth → Product Loops

## Overview
Measure what matters to ensure the runnable feed is sticky and sustainable.

## Core Metrics
- Runs per post, runs per session, time-to-first-frame (TTFF), restart rate.
- Remix rate per capsule, fork lineage depth.
- Creator activation: first publish time, repeat publish rate.
- Social: follows, comments, shares; embed-driven runs.

## Instrumentation
- Player events: boot_start, boot_ready, set_param, restart, kill, error.
- Network: proxy requests per capsule/host; rate-limit hits.
- Storage: bundle sizes, plan quota usage; cost by component.

## UX Touches
- “Runs” and “Remixes” as visible social proof on cards and profiles.
- Progress banners: “You’ve used 74% of your included runs.”
- Weekly “Vibe Pack”: most remixed capsules; email + in-app.

## Stack
- Product analytics: PostHog or Umami (privacy-friendly).
- Backend: Workers Analytics Engine + D1 summaries.

## Sources
- PostHog: https://posthog.com/
- Cloudflare Analytics Engine: https://developers.cloudflare.com/analytics/analytics-engine/

