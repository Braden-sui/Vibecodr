# Research: Moderation & Safety → Trust

## Overview
Anticipate abuse vectors and implement minimal, effective moderation for runnable content.

## Abuse Vectors
- Malicious code: crypto miners, network exfiltration, phishing UI overlays.
- Resource abuse: CPU/memory hogging, infinite loops, runaway requests.
- Content: NSFW, hate, harassment, spam, license violations.

## Guardrails (MVP)
- Technical
  - Sandbox + CSP + permission policy (deny by default).
  - Net proxy with per-host allowlist and rate limits; block cross-origin cookies.
  - CPU/memory/time budgets; kill switch in UI; per-user run quotas.
  - Immutable bundles; content hash; verify on load.
- Product
  - Report flow on posts/comments; soft-quarantine status; appeal process.
  - Rate limits on posting, comments, remixes; captcha on spikes.
  - Basic keyword filters for titles/descriptions; manual review queue.

## Policy Notes
- Clear rules on prohibited content and acceptable use.
- DMCA takedown workflow and license attribution guidance in Studio.
- Temporary suspensions for repeat violations; audit log for staff actions.

## UX Recommendations
- Visible safety badges; quick “Report” action on Player.
- Quarantine banner on flagged content with option to view.
- Transparent notices when limits are hit; show remaining quota.

## Sources
- CSP: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- Permission Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Permissions_Policy

