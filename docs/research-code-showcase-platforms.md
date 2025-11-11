# Research: Code Showcase Platforms → Runner UX

## Overview
Survey of CodePen, JSFiddle, StackBlitz, CodeSandbox, Replit, Glitch, Observable, and Hugging Face Spaces to inform how Vibecodr runs apps inside the feed and Player.

## Platform Patterns
- CodePen/JSFiddle: client-only HTML/CSS/JS sandboxes, quick embeds, instant preview.
- StackBlitz WebContainers: in-browser Node-like runtime; heavy, best for small demos.
- CodeSandbox/Glitch/Replit: cloud VMs/containers; strong multi-file editors; slower cold starts.
- Observable: notebook-centric, parameterized cells; great for data viz.
- Hugging Face Spaces: app hosting for ML (Gradio/Streamlit); iframe embeds with resource quotas.

## Options for Vibecodr
- Capsule types (MVP focus first)
  - client-static (MVP): pure static bundles; fastest, cheapest.
  - webcontainer (flagged): Node toolchains and small CLIs; size/CPU caps.
  - worker-edge (later): tiny server logic per app using edge functions.
- Param surface: manifest declares UI controls; Player binds to app via postMessage.
- Asset policy: immutable content-hashed bundles in object storage; zero egress.

## UX Recommendations
- Import frictionless: ZIP or GitHub; auto-detect entry; show validation inline.
- Preview always: render a small live preview on Studio and Feed hover.
- Clear capabilities: always show badges for network/storage/runtime.
- Restart affordance: instant “Restart” without full reload using checkpoint/shim.

## Technical Guardrails
- Enforce bundle caps by plan (e.g., 25MB Free/Creator; 100MB Pro; 250MB Team).
- Network default deny; allowlist per-host via proxy; show host list in UI.
- CPU/memory budgets per run; terminate runaway apps; expose a kill switch.
- Log capture shim for console and basic FPS; sample to analytics.

## Sources
- StackBlitz WebContainers: https://developer.stackblitz.com/platform/webcontainers/
- CodePen embeds: https://blog.codepen.io/documentation/embedded-pens/
- Replit embeds: https://docs.replit.com/hosting/embedding-repls
- Observable: https://observablehq.com/
- Hugging Face Spaces: https://huggingface.co/docs/hub/spaces-overview

