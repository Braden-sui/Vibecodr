# Content Moderation States Specification

**Version:** 1.0  
**Last Updated:** 2025-11-28  
**Status:** Canonical Definition (aligned to current code)

---

## Overview

Three moderation states exist today. The Worker API and SPA both enforce them. This document reflects the behavior that actually ships in code.

---

## State Definitions

### 1. ALLOW (`action: "allow"`)

**Database:** `quarantined = 0` or `NULL`  
**HTTP Response:** 200 OK (normal)

| Aspect | Behavior |
|--------|----------|
| **Feed visibility** | Appears in all feeds (home, discover, following, profile) |
| **Direct access** | Accessible via direct URL |
| **Embed** | Embeddable |
| **Search** | Indexed and searchable |
| **Owner notification** | None |
| **Moderation queue** | Not queued |

**Trigger:** Safety check returns `risk_level: "low"` with no pattern matches.

---

### 2. QUARANTINE (`action: "quarantine"`)

**Database:** `quarantined = 1`, `quarantine_reason` set, `quarantined_at` timestamp  
**HTTP Response:** 404 for non-moderators; 200 with `quarantined` flag for moderators

| Aspect | Behavior |
|--------|----------|
| **Feed visibility** | Hidden from all feeds (including moderators) |
| **Direct access — posts** | 404 for everyone except moderators (owners do **not** bypass today) |
| **Direct access — capsules** | Allowed for owner or moderator; 404 for others |
| **Manifest/bundle** | Requires a non-quarantined public post or moderator override; owners are blocked when every linked post is quarantined |
| **Embed** | Blocked: embed/oEmbed returns 404 for quarantined posts |
| **Search** | Excluded |
| **Owner notification** | Not implemented |
| **Moderation queue** | Appears in `/moderation/flagged` for review |

**Triggers:**
- Auto-quarantine on publish: suspicious patterns detected (see `QUARANTINE_PATTERNS` in safety pipeline)
- Manual moderation: `POST /moderation/posts/:id/action { action: "quarantine" }`
- Report resolution: `POST /moderation/reports/:id/resolve { action: "quarantine" }`

---

### 3. BLOCK (`action: "block"`)

**Database:** N/A (content never persisted)  
**HTTP Response:** 403 Forbidden

| Aspect | Behavior |
|--------|----------|
| **Feed visibility** | N/A - never exists |
| **Direct access** | N/A - never exists |
| **Embed** | N/A - never exists |
| **Search** | N/A - never exists |
| **Owner notification** | Immediate error: "Content rejected: [reason]" |
| **Moderation queue** | Logged to analytics only |

**Triggers:**
- Hash blocklist match (known malicious hash in KV)
- High-risk pattern match (see `BLOCK_PATTERNS` in safety pipeline)

---

## State Transitions (current code paths)

- **Publish flow:** Upload → safety check → `allow | quarantine | block`. Quarantine sets flags and timestamps; block returns 403.
- **Moderation flow:** Moderators call `POST /moderation/posts/:id/action` with `quarantine | unquarantine | remove`. Removes hard-delete; unquarantine clears the flag.
- **Reports:** Moderators resolve reports with `dismiss | quarantine`; quarantine path uses the same action handler and audit logging.

---

## API Surface Behavior

### Feed Endpoints

| Endpoint | Quarantined Content |
|----------|---------------------|
| `GET /posts` (home feed) | Excluded for all |
| `GET /posts/discover` | Excluded for all (moderators rely on `/moderation/*` instead) |
| `GET /posts?mode=following` | Excluded for all |
| `GET /users/:id/posts` | Excluded for all |

### Direct Access Endpoints

| Endpoint | Quarantined Content |
|----------|---------------------|
| `GET /capsules/:id` | Allowed for owner or moderator; 404 for others |
| `GET /capsules/:id/verify` | Allowed for owner or moderator; 404 for others |
| `GET /posts/:id` | 404 for non-moderators; moderators can fetch with `quarantined` flag |
| `GET /capsules/:id/manifest` | Requires a non-quarantined public post or moderator override; owners cannot bypass when every linked post is quarantined |
| `GET /capsules/:id/bundle` | Same gating as manifest via `authorizeCapsuleRequest` |
| `GET /artifacts/:id/bundle` | No quarantine check (artifacts use their own policy status) |

### Embed and SEO Endpoints

| Endpoint | Quarantined Content |
|----------|---------------------|
| `GET /e/:postId` | Returns 404 when quarantined or author is suspended/shadow-banned |
| `GET /oembed` | Returns 404 when target post is quarantined |
| `GET /og-image/:postId` | Returns 404 when post is missing (quarantined posts are not reachable by id for non-mods) |

---

## Moderation API (implemented)

### Quarantine a Post
```http
POST /moderation/posts/:postId/action
Authorization: Bearer <mod_token>
Content-Type: application/json

{ "action": "quarantine", "notes": "Suspicious network calls detected" }
```

### Unquarantine a Post
```http
POST /moderation/posts/:postId/action
Authorization: Bearer <mod_token>
Content-Type: application/json

{ "action": "unquarantine", "notes": "False positive - fetch is for public API" }
```

### Remove a Post (Hard Delete)
```http
POST /moderation/posts/:postId/action
Authorization: Bearer <mod_token>
Content-Type: application/json

{ "action": "remove", "notes": "Confirmed malicious after manual review" }
```

---

## Audit Trail

All moderation actions are logged to `moderation_audit_log` with `action`, `target_type`, `target_id`, `notes`, and `moderator_id`.

---

## User-Visible Messages

- **Quarantined post (moderator view):** Player page shows "This post is quarantined" with an unquarantine button for moderators.
- **Owner banner:** Not implemented (owners currently receive 404 for quarantined posts).
- **Publish block:** `"Unable to publish: Content rejected"` with `E-VIBECODR-SECURITY-BLOCK`.

---

## Gaps to Address

1. **Owner access/notification:** Owners cannot view quarantined posts; no banner or alert is sent.
2. **User notification:** No system to notify users when content is quarantined or unquarantined.
3. **Appeal flow:** No self-service appeal mechanism.
4. **Analytics/dashboard:** No dashboard for quarantine rates, false positives, or moderator actions.

---

## Error Codes

| Code | Meaning |
|------|---------|
| `E-VIBECODR-SECURITY-BLOCK` | Publish rejected due to block pattern |
| `E-VIBECODR-0507` | Capsule flagged for auto-quarantine on publish |
| `E-VIBECODR-0508` | Capsule auto-quarantined (audit log) |
| `E-VIBECODR-0509` | Capsule under review; direct access restricted |
| `E-VIBECODR-0102` | Moderation quarantine action failed |
| `E-VIBECODR-0103` | Direct quarantine failed |
| `E-VIBECODR-0105` | Unquarantine failed |
| `E-VIBECODR-0605` | Embed schema introspection failed |
| `E-VIBECODR-0612` | Not embeddable (quarantined/private/suspended/shadow-banned) |

---

## Implementation Checklist

- [x] `SafetyAction` type defined (`allow` | `quarantine` | `block`)
- [x] Quarantine vs block patterns separated
- [x] Auto-quarantine on publish (`handlers/capsules.ts`)
- [x] Feed filtering excludes quarantined posts (`handlers/posts.ts`, `handlers/profiles.ts`)
- [x] Moderation quarantine/unquarantine/remove endpoints (`handlers/moderation.ts`)
- [x] Audit log for moderation actions
- [x] Capsule-level quarantine filtering (`capsule-access.ts`, manifest/bundle auth)
- [x] Embed/oEmbed quarantine check (`handlers/embeds.ts`)
- [ ] User notification on quarantine/unquarantine
- [ ] Owner-visible banner or alternate owner access path
- [ ] Appeal workflow
- [ ] Quarantine analytics dashboard
