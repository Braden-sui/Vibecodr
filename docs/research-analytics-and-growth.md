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
- Product analytics: Cloudflare Workers Analytics Engine (frontend events and pursed dashboards).
- Backend: Workers Analytics Engine + D1 summaries for aggregations.

## Runtime telemetry
- Runtime-specific signals (`runtime_manifest_*`, `runtime_frame_loaded`, `runtime_error`, `runtime_policy_violation`, etc.) are sent via `POST /runtime-events`. They land in both the Analytics Engine and the `runtime_events` D1 table, so dashboards/alerts can slice by capsule, artifact, runtime type, or error code. Ingestion returns HTTP 500 with `E-VIBECODR-2130` and `retryable: true` if persistence fails; clients should retry once and treat non-2xx responses as failures (no more best-effort 202s).
- An administrator dashboard at `/admin/analytics` queries `/runtime-analytics/summary` and is the home for monitoring traces, plus it drives the Cloudflare dashboards and alert rules you'll add in staging.

## Sources
- Cloudflare Analytics Engine: https://developers.cloudflare.com/analytics/analytics-engine/
