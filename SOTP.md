# State of the Project: Vibecodr Forensic Audit

**Date:** November 24, 2025  
**Total Files Analyzed:** 58+ source files  
**Critical Issues:** 4 | **High Issues:** 6 | **Strengths:** 12  

---

## 1. Executive Summary

Vibecodr is a social platform for sharing runnable "vibes" (capsules)—mini-apps that execute in sandboxed iframes. The architecture demonstrates solid foundational security: iframe sandboxing, nonce-based CSP, structured error codes, and layered Clerk JWT auth in Cloudflare Workers.

**Critical gaps exist in three areas:**

1. **Sandbox inconsistency**: FeedCard uses `allow-scripts allow-same-origin` vs PlayerIframe's stricter `allow-scripts` only

2. **Incomplete budget enforcement** for WebContainer runners

3. **Safety heuristics log but don't block** suspicious patterns in MVP mode

**Overall risk posture: MEDIUM** for MVP. Defense-in-depth (iframe sandbox + CSP + guard.js + origin validation) provides reasonable protection.

---

## 2. Security Architecture

### 2.1 CSP & Sandbox Configuration

**[CRITICAL] Sandbox Attribute Inconsistency:**

| Location | Sandbox Value | Risk |
|----------|---------------|------|
| `lib/runtime/sandboxPolicies.ts:1` | `allow-scripts` | Safe |
| `components/Player/PlayerIframe.tsx:552` | `RUNTIME_IFRAME_SANDBOX` | Safe |
| `components/FeedCard.tsx:746` | `allow-scripts allow-same-origin` | **DANGEROUS** |
| `public/embed.js:16` | `allow-scripts allow-same-origin` | **DANGEROUS** |
| `lib/profile/blocks.tsx:308` | `allow-scripts allow-same-origin` | **DANGEROUS** |

**Why this matters:** Per MDN/OWASP, `allow-scripts + allow-same-origin` allows sandboxed content to remove sandbox restrictions entirely.

**Industry comparison:**

- CodePen uses separate domain (`cdpn.io`) for preview isolation
- Source: <https://blog.codepen.io/2017/02/06/allowing-codepen-via-csp/>

### 2.2 Runtime Guard

**File: `public/runtime-assets/v0.1.0/guard.js:1-100`**

Disables: localStorage, sessionStorage, document.cookie, window.open, link navigation, form submission.

**[STRENGTH]** Layered defense beyond sandbox attribute.

### 2.3 Safety Checks

**File: `workers/api/src/safety/safetyClient.ts:24-33`**

Heuristic patterns detected:
- `child_process|exec|spawn|fork`
- `eval|new Function`
- `while\s*\(true\)|for\s*\(\s*;\s*\)`
- `stratum\+tcp|xmrig` (crypto-miner)

**[HIGH] MVP Mode Bypass:**

```javascript
// File: workers/api/src/safety/safetyClient.ts:63-75
// Returns safe: true regardless of heuristics
return { safe: true, risk_level: suspicious.length > 0 ? "medium" : "low", ... };
```

---

## 3. Runtime System

### 3.1 Budget Enforcement

**File: `components/Player/runtimeBudgets.ts:11-16`**
```javascript
const DEFAULT_BUDGETS = {
  maxConcurrentRunners: 2,
  clientStaticBootMs: 5_000,
  webContainerBootMs: 8_000,
  runSessionMs: 60_000,
};
```

**[HIGH] Not Enforced:**

- WebContainer boot timeout defined but not enforced client-side
- Session timeout (`runSessionMs`) has no enforcement code
- Kill switch doesn't actually terminate JavaScript

**Industry comparison:**

- Cloudflare Workers: CPU time limits enforced by V8, automatic termination
- Source: <https://developers.cloudflare.com/workers/reference/security-model/>

### 3.2 Feature Parity Matrix

| Feature | PlayerIframe | FeedCard |
|---------|--------------|----------|
| Sandbox `allow-scripts` only | ✅ | ❌ |
| CSP meta tag | ✅ | ❌ |
| guard.js | ✅ | ❌ |
| Parent origin validation | ✅ | Partial |

---

## 4. Critical Findings Matrix

| Finding | Severity | File | Action |
|---------|----------|------|--------|
| FeedCard sandbox allows same-origin | CRITICAL | `FeedCard.tsx:746` | FIX NOW |
| embed.js sandbox allows same-origin | CRITICAL | `embed.js:16` | FIX NOW |
| Profile block sandbox allows same-origin | CRITICAL | `blocks.tsx:308` | FIX NOW |
| Safety heuristics don't block | HIGH | `safetyClient.ts:63` | FIX NOW |
| WebContainer budget not enforced | HIGH | `runtimeBudgets.ts` | FIX |
| Session timeout not enforced | HIGH | `runtimeBudgets.ts:15` | FIX |
| Kill switch doesn't terminate JS | HIGH | `client-static-shim.js:208` | INVESTIGATE |
| FeedCard lacks guard.js | MEDIUM | `FeedCard.tsx:740` | FIX |
| No feed virtualization | MEDIUM | Feed components | Later |
| Nonce-based CSP | STRENGTH | `SandboxFrame.tsx:43` | DO NOT TOUCH |
| Parent origin validation | STRENGTH | `client-static-shim.js:48` | DO NOT TOUCH |
| Fail-closed rate limiting | STRENGTH | `rateLimit.ts:60` | DO NOT TOUCH |
| Network access blocked | STRENGTH | `manifest.ts:280` | DO NOT TOUCH |

---

## 5. Strengths (Do Not Touch)

1. **Nonce-Based CSP** - `SandboxFrame.tsx:43-54`
2. **Parent Origin Validation** - `client-static-shim.js:48-57`
3. **Guard.js Runtime Hardening** - `guard.js:1-100`
4. **Network Access Blocked** - `manifest.ts:280-286`
5. **Fail-Closed Rate Limiting** - `rateLimit.ts:60-65`
6. **Structured Error Codes** - `errors.ts` (150+ codes)
7. **Zod Schema Validation** - `manifest.ts:116-145`
8. **JWKS Caching** - `auth.ts:375-431`
9. **Moderation Audit Trail** - `moderation.ts:92-115`
10. **Visibility-Based Pause** - `FeedCard.tsx:436-462`

---

## 6. Immediate Actions (72 Hours)

### CRITICAL (Do First)

1. **Fix FeedCard Sandbox** - `FeedCard.tsx:746`
   - Change: `sandbox="allow-scripts allow-same-origin"` → `sandbox="allow-scripts"`
   - Effort: 1 hour

2. **Fix Embed Sandbox** - `embed.js:16`
   - Change: `'allow-scripts allow-same-origin'` → `'allow-scripts'`
   - Effort: 30 min

3. **Fix Profile Block Sandbox** - `blocks.tsx:308`
   - Same change
   - Effort: 30 min

### HIGH (Next)

1. **Enable Safety Blocking** - `safetyClient.ts`
   - Add env flag to block high-risk patterns (xmrig, infinite loops)
   - Effort: 2 hours

2. **Add FeedCard Guard** - `FeedCard.tsx`
   - Inject guard.js into feed preview iframes
   - Effort: 3 hours

---

## 7. Medium-Term Improvements (2-4 Weeks)

1. Implement feed virtualization (react-window)
2. Add React Error Boundaries
3. Enforce session timeouts with Worker Alarm
4. Add WebContainer kill mechanism

---

## 8. Decisions (Resolved)

1. **FeedCard sandbox change** → **APPROVED: Change to `allow-scripts` only**
   - Breaking same-origin blocks localStorage/cookies and same-origin messaging
   - Previews only need fetch to API + postMessage to parent — acceptable
   - Action: Default to sandboxed iframe + explicit postMessage contract
   - Action: Add "feature check" in preview that flags missing capabilities before enabling

2. **Safety blocking** → **QUARANTINE by default**
   - Hide from feeds/listings, keep for moderator review
   - Hard block only for high-confidence severe violations (malware hash match)
   - Quarantine preserves evidence and lowers false-positive fallout
   - Action: Add clear audit trail and user-visible status
   - Action: Allow moderators to unblock with reason

3. **WebContainer budget** → **Target 4-5s p95, hard kill at 6s**
   - 8s is too long for perceived snappiness
   - Action: Hard kill at ~6s with retry/backoff
   - Action: Log latency to tune
   - For heavy boots: gate behind "loading environment" UI, measure separately

4. **Feed virtualization** → **MEDIUM priority (backlog)**
   - Deprioritize unless feeds exceed hundreds of rows or scrolling jank reported
   - If memory creep or render jank observed, escalate immediately
   - Keep windowed list (react-window) in backlog

---

## 9. Research Sources

1. CodePen CSP Blog - <https://blog.codepen.io/2017/02/06/allowing-codepen-via-csp/>
2. Google Strict CSP - <https://csp.withgoogle.com/docs/strict-csp.html>
3. Cloudflare Workers Security - <https://developers.cloudflare.com/workers/reference/security-model/>
4. Cloudflare V8 Sandbox - <https://blog.cloudflare.com/safe-in-the-sandbox-security-hardening-for-cloudflare-workers/>
5. Tauri Process Model - <https://v2.tauri.app/concept/process-model/>
6. MDN CSP script-src - <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src>
7. React Virtualization - Medium article on react-window vs react-virtuoso

---

**Which open questions should I investigate first?**  
**Are there specific areas you want me to expand on with deeper research?**
