# Research: Sandbox & Runner → Safety First

## Overview
Define how we safely run user apps inside the feed, what capabilities are allowed, and the RPC bridge between Player and app.

## Browser Sandboxing
- iframe sandbox attribute: start with `allow-scripts allow-same-origin` as needed, deny forms/popups by default, add specific flags only when required.
- Strict CSP: default-src 'none'; script-src 'self' blob:; connect-src via proxy; img/media/style limited.
- Permission Policy: disallow sensors, camera, mic by default.

## Capability Model (Manifest)
- net: [] allowlist of hosts; proxied and rate-limited. (Currently disabled until premium VM tiers launch.)
- storage: false by default; if true, limit to IndexedDB quota with guard.
- workers: reserved for future premium runtimes; current MVP disables web worker access entirely.
- params: declarative UI controls surfaced in Player.

## Runner Bridge
- postMessage channel + handshake: ready → setParam(name,value) → stats/logs.
- Console proxy to capture logs/errors; send to analytics with sampling.
- Restart: capture DOM snapshot or reload with quick prefetch of initial assets.

## Technical Budgets
- Boot time ≤ 1s P95 for client-static; show skeleton until ready.
- CPU wall-time per run (e.g., 60s) with kill.
- Memory soft limit (observe via performance APIs and heuristics).

## UX Recommendations
- Always-on perf meter; obvious kill/restart buttons.
- Show capability badges inline; link to privacy/safety help.
- Smooth param controls; debounced updates; display current value clearly.

## Sources
- MDN iframe sandbox: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#attr-sandbox
- CSP basics: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
