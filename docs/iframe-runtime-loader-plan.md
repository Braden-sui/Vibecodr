# Iframe Runtime Loader Plan (v1)

## Context and Goal
- **Problem:** Capsules currently cannot execute user-authored artifacts inline without tying up server resources or risking unsafe code paths. We need a Claude Artifacts-style runtime so capsules feel premium while compute stays client-side.
- **Goal:** Deliver a hardened iframe loader system that compiles, validates, and serves artifacts (React JSX + plain HTML) while letting them run entirely in the browser sandbox. Output must support embedding inside feed capsules immediately after v1 ships.
- **Why now:** Unlocks interactive capsules in the timeline, aligns with the moderation roadmap, and drives down infra spend before broader beta invites. This also unblocks the team working on the "logged-in" experience from relying on placeholder emojis.
- **Autonomy tier:** **T1 Caution** (public-facing runtime behavior with security impact). Impact=3 (user-visible), Irreversibility=2 (can revert manifests), Confidence target=4 once tests + manual verifications complete. \(R = (3x2)/4 = 1.5\) => operate with T1 rigor.

## Phased Execution & Concurrency
Use the following waves to parallelize safely. Each *STOP* marks a hard dependency checkpoint before advancing to the next wave.

- **Wave 0 - Kickoff (serial)**
  - Finalize artifact schema + error code map (Checklist Section 1.1-1.3).
  - Outcome: shared contract for all downstream work.
- *STOP 0:* Do not begin compile or runtime asset work until schema + codes are approved.

- **Wave 1 - Parallel Foundations**
  - Track A: Checklist Section 2 (Compile & Storage Pipeline) - Worker scaffolding, upload flow, React/HTML compilation, manifest emission.
  - Track B: Checklist Section 3 (Runtime Assets) - Build runtime bundles, guard script stubs, publish versioned assets.
  - These tracks can proceed concurrently once Wave 0 completes.
- *STOP 1:* Hold before Wave 2 until Track A (manifest endpoints live) and Track B (runtime bundle v1 published) pass validation.

- **Current status (Wave 1):** Artifact schema and error codes are complete; artifact upload endpoints and the ArtifactCompiler Durable Object are scaffolded; runtime bundle v0.1.0 (bridge, guard, React + HTML runtimes) is checked in under `apps/web/public/runtime-assets/v0.1.0/` and indexed via `runtime-index.json` with a Turbo-powered checksum validation task.

- **Wave 2 - Client Runtime Surfaces**
  - Track A: Checklist Section 4 (Frontend Registry & Loader) - registry module, SandboxFrame, React/HTML loaders.
  - Track B: Checklist Section 5 (Policy Enforcement) - guard script shims, heartbeat protocol, CSP headers, optional proxy.
  - Track C: Checklist Section 6 (Observability & Admin) - telemetry ingestion, dashboards, admin tooling; pieces depending on compile/runtime events may start as soon as those events exist.
- *STOP 2:* Do not proceed to integration until loaders (Track A) and policy guards (Track B) are feature complete and emitting telemetry required by Track C.

- **Wave 3 - Integration & Rollout**
  - Checklist Section 7 tasks: wire FeedCard, QA, security review, creator docs, staged rollout, cleanup.
  - Requires STOP 2 deliverables plus baseline observability (Track C).
- *STOP 3:* Launch decision gate; confirm dashboards are green and rollback plan rehearsed before enabling for all users.

## Constraints & Invariants
- All runtime execution must happen client-side inside sandboxed iframes. Server footprint limited to upload validation, compilation, storage, and optional network proxying.
- No `localStorage`, `sessionStorage`, IndexedDB, or cookies in artifacts. Forms, navigation, `window.open`, and top-level navigation are forbidden.
- Error messaging must use structured codes `E-VIBECODR-####` with actionable text.
- ASCII only, strict lint/type settings, and no TODO/FIXME markers per repo policy.
- Observability: compile and runtime telemetry must emit structured events with artifact/user identifiers.
- Hosting target: Cloudflare Workers + R2/KV for bundles, Cloudflare Pages (or Workers static) for runtime assets, Next.js for host UI.
- Runtime iframes are cross-origin from the host UI (for example, `runtime.vibecodr.com` vs `vibecodr.space`) and use `sandbox="allow-scripts"`; all coordination happens via `postMessage`.
- Feed auto-run is allowed, but lifetime must be bounded: auto-started iframes that never receive user interaction are killed quickly (for example, after roughly 10 seconds), scrolled-out iframes are unloaded, and global concurrency caps keep the number of active iframes within safe limits.

## High-Level Architecture
1. **Artifact Spec Layer:** Backend API stores artifact metadata, version, type, dependency declarations, and runtime manifest references. Acts as source of truth for loaders.
2. **Compile & Validation Service:** Cloudflare Worker/Durable Object that accepts artifact uploads, runs esbuild/SWC (React) or HTML sanitization, ensures imports and network allowlists comply, and emits artifacts + manifests to storage.
3. **Runtime Asset Hosting:** Versioned runtime bundles (React runtime, HTML runtime, guard scripts, Tailwind core CSS) served from `runtime.vibecodr.com`.
4. **Frontend Runtime Registry:** Client-side module mapping artifact `type` to loader functions. Provides consistent API to FeedCard and other surfaces.
5. **Sandbox Loader (Iframe):** React component that mounts a locked-down iframe, injects manifest details, wraps with guard script, and bridges telemetry via `postMessage`.
6. **Policy Enforcement:** CSP headers + iframe sandbox flags, guard script for API shims, heartbeat monitoring, optional request proxy with allowlists.
7. **Observability + Admin:** Structured logging for compile, runtime events, policy violations, plus tooling to revoke or recompile artifacts.

## Component Details
### Artifact Spec & Storage
- Schema fields: `id`, `ownerId`, `type`, `entry`, `files`, `deps`, `networkAllow`, `envAllow`, `runtimeVersion`, `bundleDigest`, `status`.
- Store raw sources in R2 under `artifacts/{id}/{version}/sources.tar`.
- Manifest JSON stored in KV for low-latency fetch: `{ bundleUrl, cssUrls[], runtimeBaseUrl, sandboxFlags, allowDomains, sizeBytes, checksum }`.
- API endpoints:
  - `POST /artifacts` (create + upload session)
  - `PUT /artifacts/:id/complete` (trigger compile)
  - `GET /artifacts/:id/manifest` (host loader fetch)
  - `POST /artifacts/:id/revoke` (soft-delete manifest, mark as unsafe)
- Validation returns typed errors with actionable hints (e.g., `E-VIBECODR-1103 unsupported import "fs"`).

### Compile + Validation Worker
- Runs inside Durable Object for per-artifact serialization.
- React pipeline:
  1. Parse file list, ensure single entry point.
  2. Use esbuild target `es2017`, format ESM, tree-shake.
  3. Block dynamic `require`, `eval`, or bare `new Function`.
  4. Validate imports against allowlist (`react`, `react-dom`, `lucide-react`, `recharts`, `d3`, `three`, `clsx`, etc.).
  5. Size budget: fail if >1.5 MB gzip w/ `E-VIBECODR-1110 artifact too large`.
- HTML pipeline:
  1. Run DOMPurify (server-side) with restrictive config; strip inline event handlers except `data-*`.
  2. Reject `<script>` tags except whitelisted libs (CDN script tags declared in metadata).
  3. Insert `<base href="https://runtime.vibecodr.com/html-base/">` and wrap body inside container div for styling.
- Both pipelines emit manifest + bundle to storage and log compile metrics.

### Runtime Asset Hosting
- Maintain versioned bundles in repo under `apps/web/public/runtime-assets/v<semver>/`.
- Deploy to Cloudflare static hosting with hashed filenames for cache busting.
- Provide `runtime-index.json` listing available versions for rollback safety.

### Frontend Runtime Registry
- Module `apps/web/lib/runtime/registry.ts` exporting:
  ```ts
  type RuntimeLoader = (opts: LoaderArgs) => ReactNode;
  const registry = new Map<string, RuntimeLoader>();
  export function registerRuntime(type: string, loader: RuntimeLoader) { ... }
  export function loadRuntime(type: string, opts: LoaderArgs) { ... }
  ```
- Default registrations for `react-jsx` and `html`.
- Loader args include manifest URL, artifact id, telemetry hooks, sizing hints.

### Sandbox Frame Component
- `SandboxFrame` props: `manifest`, `title`, `height`, `onReady`, `onError`, `onPolicyViolation`.
- Generates `<iframe>` with:
  - `src` pointing at prebuilt runtime HTML on `runtime.vibecodr.com` (or equivalent runtime host) that includes the skeleton UI, guard script, and runtime bootstrap; the host page only uses `postMessage` to send params and receive telemetry.
  - Attributes: `sandbox="allow-scripts"`, `referrerpolicy="no-referrer"`, `aria-label`.
  - `style` enforcing responsive sizing + fallback message.
- Guard script responsibilities:
  - Override forbidden APIs (`localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`).
  - Block form submission + navigation methods.
  - Intercept `fetch`, `XMLHttpRequest`, WebSocket, and compare target host against `allowDomains`.
  - Emit telemetry events via `postMessage`.

### React Runtime Implementation
- Shared boot script:
  ```js
  import React from "react";
  import ReactDOM from "react-dom/client";
  import * as runtimeBridge from "./bridge";
  window.React = React;
  window.ReactDOM = ReactDOM;
  ```
- Loads Tailwind core CSS via CDN `<link>` (no custom config).
- When artifact bundle loads, expects default export `RuntimeArtifact`.
- runtimeBridge exposes limited APIs (event emitters, asset fetching helper).
- Handles runtime errors by catching promise rejections and notifying parent with `E-VIBECODR-2101 artifact runtime crash`.

### HTML Runtime Implementation
- Inject sanitized HTML into iframe body.
- Append runtime bridge script that:
  - Observes DOM mutations for suspicious nodes; removes new `<script>` tags not allowed.
  - Provides `window.runtime` object for telemetry/logging.
  - Enforces size constraints by observing layout shifts (optional).

### Network & Policy Controls
- Default network allowlist is empty; artifacts must declare domains to fetch via `capabilities.net` in the capsule manifest, and those domains are enforced server-side by the Worker proxy.
- `capabilities.net` entries are not direct carte blanche network access: they are combined with a global allowlist and only applied when the caller owns the capsule; requests that try to reuse another user’s capsule ID are rejected by `/api/proxy`.
- The Worker proxy (`/api/proxy`) is the only supported path for runtime network calls and remains optional but recommended for auditability and SSRF defenses.
- Heartbeat: guard script posts `{"type":"heartbeat"}` every 5 s; host kills iframe if missing >15 s.
- Rate limits: host tracks per-user concurrent artifacts to prevent resource abuse.
- Auto-run lifecycle (feed): the host may auto-start runtime when a card enters the viewport, but must enforce an engagement window (for example, kill if there is no hover/click/param interaction within roughly 10 seconds), unload iframes that are far outside the viewport, and cap the number of simultaneously active auto-run iframes (for example, 5–7) to keep CPU and memory usage bounded.

### Observability & Admin Tooling
- **Compile logs:** artifact id, owner, duration, bundle size, violations (including `bundle.*` warnings emitted by `workers/api/src/runtime/esbuildBundler.ts`) exported as structured events (`bundle_warning_count`) via `vibecodr_analytics_engine`.
- **Runtime logs:** event types `runtime_init`, `runtime_ready`, `runtime_error`, `policy_violation`, `heartbeat_timeout`.
- Dashboard widgets: compile success %, average runtime bootstrap latency, top violation codes.
- Admin UX: internal page to view artifact manifests, revoke, trigger recompile with new runtime version.
- Runtime telemetry pipeline: runtime events are posted to the Worker (`/runtime-events`), persisted to `runtime_events`, and surfaced in `/admin/analytics` so the admin dashboards/alerts you build can rely on the same dataset before broader rollout. Ingestion now returns HTTP 500 with `E-VIBECODR-2130` and `retryable: true` when D1 writes fail; clients must treat non-2xx as failures and perform a bounded retry instead of assuming 202.
- Inline JS apps now go through the same JS runtime path (webcontainer/react-jsx) as full artifacts: we bundle with esbuild, store `artifacts/<artifactId>/bundle.js`, and feed the existing runtime manifest/loader. A Bedrock safety gate (GPT-OSS 120B) runs on all submitted files before bundle upload and logs verdict metadata; HTML inline remains JS-free and sanitized via the `client-static` runner.

### Testing & Validation
- **Unit:** schema validation, import allowlist, guard script functions, registry behavior.
- **Integration:** upload artifact fixtures -> compile -> fetch manifest -> load iframe via Playwright to assert sandbox rules.
- **Security:** fuzz inputs with malicious HTML/JS, verify sanitization + guard script catch them; pen-test network restrictions.
- **Performance:** measure compile time (<2 s median), runtime bootstrap (<200 ms on M1 Air), memory usage (iframe <50 MB).
- **Observability:** ensure events fire even on failures; add golden tests for telemetry payload shapes.

### Risks & Mitigations
- **Escape from sandbox:** Mitigate with strict CSP, sandbox flags, guard script, and browser compatibility tests.
- **Compile latency spikes:** Mitigate via worker caching, rate limiting, and instrumentation; fall back to cached bundles.
- **Allowlist drift:** Keep central config file with tests; require approvals for new libraries/domains.
- **User confusion on errors:** Provide surfaced error states inside FeedCard with guidance + error codes.

## Chronological Checklist
1. **Foundations**
   - [x] 1.1 Draft artifact schema changes and ERD updates grounded in social-app standards.  
       - Align `artifacts` and `artifact_manifests` tables with the fields in "Artifact Spec & Storage" (`id`, `ownerId`, `type`, `entry`, `files`, `deps`, `networkAllow`, `envAllow`, `runtimeVersion`, `bundleDigest`, `status`).  
       - Add safety and visibility metadata common in large social apps, such as `visibility` (public/unlisted/private), `policyStatus` (active/quarantined/removed), `safetyTier`, `riskScore`, `lastReviewedAt`, `lastReviewedBy`, and soft-delete markers.  
       - Update the ERD to show relationships to `users`, `capsules`/`posts`, moderation queues, and audit/audit-log tables; ensure 1:N versioning between artifacts, manifests, and the posts that reference them.  
   - [x] 1.2 Implement backend migrations/tables to store artifacts and manifests with moderation-grade traceability.  
       - Create or adjust D1 tables for `artifacts`, `artifact_manifests`, and (if needed) `artifact_versions` with indexes on `ownerId`, `capsuleId/postId`, `status`, `policyStatus`, and `createdAt`.  
       - Make migrations reversible and idempotent; include backfill steps to attach default visibility/safety metadata to existing capsules and manifests.  
       - Add audit columns (`createdBy`, `updatedBy`, `reviewedBy`, `reviewedAt`) where applicable so trust-and-safety reviews can be reconstructed later.  
   - [x] 1.3 Define error code map for the runtime system (reserve `E-VIBECODR-11xx` compile, `21xx` runtime).  
       - Partition code ranges by concern, for example: 1100-1119 schema/validation errors, 1120-1139 import/allowlist violations, 1140-1159 size and resource limits, 2100-2119 bootstrap/runtime-init failures, 2120-2139 network/policy violations, 2190+ trust-and-safety interventions (e.g., artifact blocked or quarantined).  
       - For each code, document user-facing message, internal description, HTTP status, severity, logging/telemetry requirements, and recommended user action; keep codes stable over time to match social-app expectations.  
       - Cross-link runtime-related codes into `api-safety-and-abuse-invariants.mdx` and ensure FeedCard and Player error UIs surface the code plus clear next steps without leaking sensitive implementation details.
2. **Compile & Storage Pipeline**
- [x] 2.1 Scaffold Cloudflare Worker/Durable Object for artifact compilation.  
- [x] 2.2 Implement authenticated upload API to R2 (signed or Worker-mediated) for artifact sources.  
- [x] 2.3 Build React compile pipeline (esbuild config, import validator, size guard).  
- [x] 2.3.1 Share `workers/api/src/runtime/esbuildBundler.ts` between import + artifact flows so every publish uses the same tree-shaken/minified output and entry detection logic, and surface bundler warnings as `bundle_warning_count` via `vibecodr_analytics_engine`.  
- [x] 2.4 Build HTML sanitize pipeline (DOMPurify config, script tag enforcement).  
  - Target: scrub HTML entries of `<script>` tags, inline handlers, and dangerous URIs before runtime execution; reuse `compileHtmlArtifact` and expose warnings in manifests.  
  - Deliverables: validator w/ tests (see `workers/api/src/runtime/compileHtmlArtifact.ts`), sanitized output added to publications, and guard script + metadata documenting the HTML-only runtime expectations.
- [x] 2.5 Emit manifests + store in KV/R2; add integration tests.  
  - Ensure each artifact run produces a validated manifest (versioned key) along with the bundler output and manifest bytes persisted to `artifact_manifests` plus runtime KV (see `persistCapsuleBundle`/`recordBundleWarningMetrics`).  
  - Integration test: upload fixture → compile pipeline → fetch manifest → verify versioned key contents when `runtimeArtifactsEnabled`; detect warnings + telemetry.  
- [x] 2.6 Instrument Worker logs + metrics dashboards.  
  - Record `bundle_warning_count` datapoints from the shared bundler (captured in `workers/api/src/runtime/bundleTelemetry.ts`) so dashboards can highlight warning spikes.  
  - Add structured logs/alerts for compile failures, include telemetry for manifest emission latency, and surface `E-VIBECODR-1114` when telemetry writes fail; tie the metrics to the ArtifactCompiler Durable Object control loop.
3. **Runtime Assets**
   - [x] 3.1 Create shared runtime bundles (React runtime, HTML runtime, guard script, bridge).  
   - [x] 3.2 Publish assets to Cloudflare static hosting with versioning + `runtime-index.json`.  
   - [x] 3.3 Wire repo build step (Turbo task) that validates runtime bundle checksums.
4. **Frontend Registry & Loader**
   4.1 Implement runtime registry module + type definitions.  
   4.2 Build `SandboxFrame` component (iframe writer, guard injection, telemetry bridge).  
   4.3 Create React runtime loader (fetch manifest -> configure SandboxFrame).  
   4.4 Create HTML runtime loader.  
   4.5 Add loading/error skeletons + error surfaces with E-codes.
5. **Policy Enforcement**
   5.1 Implement guard script API shims + network allowlist logic.  
   5.2 Add heartbeat protocol + host-side timeout handling.  
   5.3 Enforce CSP + sandbox flags via Next.js middleware or headers.  
   5.4 Build Worker proxy for allowed network calls (optional but recommended for audit).  
   5.5 Document policy behavior for creators.  
   5.6 Design and implement feed auto-run behavior: viewport-based auto-start, an engagement-window kill (for example, roughly 10 seconds for non-interacted apps), viewport-based unload, and global concurrency caps for auto-run iframes.
6. **Observability & Admin**
   6.1 Hook telemetry events to analytics/log pipeline.  
   6.2 Build Grafana (or alternative) dashboards.  
   6.3 Implement admin UI for artifact status, revoke, recompile.  
   6.4 Add alerting (compile failure rate, runtime violation spikes).
7. **Integration & Rollout**
   7.1 Connect FeedCard to runtime registry (capsule embed).  
   7.2 Run internal QA with seeded artifacts, capture metrics.  
   7.3 Conduct security review/pen test focused on iframe escape.  
   7.4 Update docs/help center for creators (supported APIs, troubleshooting).  
   7.5 Launch beta flag for staff/moderators -> collect feedback.  
   7.6 Roll out to all logged-in users once telemetry shows stable behavior.  
   7.7 Schedule follow-up cleanup (remove placeholder UI, backfill capsules lacking manifests).

## Next Steps
- Assign owners for each checklist section.
- Open implementation issues referencing this doc, ensuring each includes validation + rollback notes.
- Complete the remaining Compile & Storage Pipeline work (2.2–2.6): signed or otherwise authenticated upload flows to R2, React/HTML compile pipelines, manifest emission to KV/R2, and basic metrics wiring.
- Move into Wave 2 once STOP 1 is satisfied: implement the frontend runtime registry + loaders (Section 4) and policy enforcement layer (Section 5), using the v0.1.0 runtime assets as the backing bundles.
