# Runtime Budget Semantics

**Version:** 1.0  
**Last Updated:** 2025-11-24  
**Status:** Canonical Definition

---

## Overview

Runtime budgets control resource consumption for capsule execution. This document defines what each budget means and how it is enforced.

---

## Enforcement Types

| Type | Meaning | User Experience |
|------|---------|-----------------|
| **CAP** | Blocks action before it starts | "Too many capsules running, please wait" |
| **WARN** | Logs warning, action continues | No visible effect (telemetry only) |
| **KILL** | Terminates running action | "Runtime failed to start, please try again" |

---

## Budget Matrix

| Budget Field | Default | Enforcement | Implementation | Status |
|--------------|---------|-------------|----------------|--------|
| `maxConcurrentRunners` | 2 | CAP | `reserveRuntimeSlot()` returns `allowed=false` | ✅ Implemented |
| `clientStaticBootMs` | 5000 | KILL | `startBootTimer()` navigates to `about:blank` | ✅ Implemented |
| `webContainerBootTargetMs` | 5000 | WARN | (TODO) Log + telemetry if exceeded | ❌ Not implemented |
| `webContainerBootHardKillMs` | 6000 | KILL | `startBootTimer()` navigates to `about:blank` | ✅ Implemented |
| `webContainerBootMs` | 5000 | - | **DEPRECATED** - use above two | ⚠️ Remove in v2 |
| `runSessionMs` | 60000 | KILL | (TODO) Session timer to kill long-running | ❌ Not implemented |

---

## Detailed Definitions

### 1. maxConcurrentRunners

**Type:** CAP  
**Default:** 2  
**Env var:** `VIBECODR_RUNTIME_MAX_CONCURRENT`

Limits how many runtime iframes can execute simultaneously across all surfaces (feed previews + player).

**Enforcement flow:**

```
[User clicks "Run"]
       │
       ▼
reserveRuntimeSlot()
       │
       ├─ activeSlots < limit ─► allowed=true, slot reserved
       │
       └─ activeSlots >= limit ─► allowed=false, show message
```

**Code location:** `runtimeBudgets.ts:reserveRuntimeSlot()`

**User message when capped:**

```
Too many capsules running. Please close one before starting another.
```

---

### 2. clientStaticBootMs

**Type:** KILL  
**Default:** 5000ms (5s)  
**Env var:** `VIBECODR_RUNTIME_BOOT_MS`

Maximum time allowed for a client-static runtime (react-jsx, html) to boot and send `ready` message.

**Enforcement flow:**

```
[Runtime loads]
       │
       ▼
startBootTimer(isWebContainer=false)
       │
       ├─ ready message received ─► clearTimeout, show content
       │
       └─ 5000ms elapsed ─► KILL: iframe.src = "about:blank"
                                  Show error message
                                  Emit runtime_boot_timeout telemetry
```

**Code location:** `PlayerIframe.tsx:startBootTimer()`

**User message on kill:**

```
Runtime failed to start within 5s. Please try again.
```

---

### 3. webContainerBootTargetMs

**Type:** WARN  
**Default:** 5000ms (5s)  
**Env var:** `VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_TARGET_MS`

p95 target for WebContainer boot time. Exceeding this logs a warning but does NOT kill the runtime.

**Enforcement flow:**

```
[WebContainer loads]
       │
       ▼
Track boot start time
       │
       ▼
[ready message received]
       │
       ├─ bootTime <= 5000ms ─► normal (no action)
       │
       └─ bootTime > 5000ms ─► WARN: console.warn
                                     Emit runtime_boot_slow telemetry
                                     (runtime continues)
```

**Code location:** TODO - not yet implemented

**Console output:**

```
WARN: WebContainer boot exceeded p95 target (6234ms > 5000ms)
```

---

### 4. webContainerBootHardKillMs

**Type:** KILL  
**Default:** 6000ms (6s)  
**Env var:** `VIBECODR_RUNTIME_WEB_CONTAINER_HARD_KILL_MS`

Hard deadline for WebContainer boot. Exceeding this terminates the runtime.

**Enforcement flow:**

```
[WebContainer loads]
       │
       ▼
startBootTimer(isWebContainer=true)
       │
       ├─ ready message received ─► clearTimeout, show content
       │
       └─ 6000ms elapsed ─► KILL: iframe.src = "about:blank"
                                  Show error message
                                  Emit runtime_boot_timeout telemetry
```

**Code location:** `PlayerIframe.tsx:startBootTimer()`

**User message on kill:**

```
Runtime failed to start within 6s. Please try again.
```

---

### 5. runSessionMs

**Type:** KILL (TODO)  
**Default:** 60000ms (60s)  
**Env var:** `VIBECODR_RUNTIME_SESSION_MS`

Maximum time a capsule can run before being terminated. Prevents runaway sessions.

**Enforcement flow (proposed):**

```
[ready message received]
       │
       ▼
startSessionTimer()
       │
       ├─ user navigates away ─► clearTimeout, cleanup
       │
       ├─ user clicks "Stop" ─► clearTimeout, cleanup
       │
       └─ 60000ms elapsed ─► KILL: iframe.src = "about:blank"
                                   Show "Session ended" message
                                   Emit runtime_session_timeout telemetry
```

**Code location:** TODO - not yet implemented

**User message on kill:**

```
Session ended after 60 seconds. Click "Run" to restart.
```

---

### 6. webContainerBootMs (DEPRECATED)

**Type:** None (deprecated)  
**Default:** 5000ms  
**Env var:** `VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_MS`

**DEPRECATED:** This field exists for backward compatibility only. Use:
- `webContainerBootTargetMs` for soft warning threshold
- `webContainerBootHardKillMs` for hard kill threshold

**Migration:**

```typescript
// Old (deprecated)
webContainerBootMs: 8000

// New (explicit semantics)
webContainerBootTargetMs: 5000,  // WARN at 5s
webContainerBootHardKillMs: 6000 // KILL at 6s
```

---

## Environment Variable Reference

| Env Var | Budget Field | Type |
|---------|--------------|------|
| `VIBECODR_RUNTIME_MAX_CONCURRENT` | maxConcurrentRunners | CAP |
| `VIBECODR_RUNTIME_BOOT_MS` | clientStaticBootMs | KILL |
| `VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_MS` | webContainerBootMs | DEPRECATED |
| `VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_TARGET_MS` | webContainerBootTargetMs | WARN |
| `VIBECODR_RUNTIME_WEB_CONTAINER_HARD_KILL_MS` | webContainerBootHardKillMs | KILL |
| `VIBECODR_RUNTIME_SESSION_MS` | runSessionMs | KILL |

---

## Error Codes

| Code | Trigger | Severity |
|------|---------|----------|
| `E-VIBECODR-0526` | Boot timeout exceeded (hard kill) | ERROR |
| `E-VIBECODR-0524` | Runtime events capped for session | WARN |
| `E-VIBECODR-0525` | Runtime logs capped for session | WARN |

---

## Telemetry Events

| Event | When | Payload |
|-------|------|---------|
| `runtime_boot_timeout` | Hard kill triggered | `{ capsuleId, bootDuration, hardKillMs }` |
| `runtime_boot_slow` | Soft target exceeded (TODO) | `{ capsuleId, bootDuration, targetMs }` |
| `runtime_session_timeout` | Session limit hit (TODO) | `{ capsuleId, sessionDuration }` |

---

## Implementation Checklist

- [x] `maxConcurrentRunners` CAP enforcement
- [x] `clientStaticBootMs` KILL enforcement
- [x] `webContainerBootHardKillMs` KILL enforcement
- [ ] `webContainerBootTargetMs` WARN enforcement
- [ ] `runSessionMs` KILL enforcement
- [ ] Remove deprecated `webContainerBootMs` in v2
