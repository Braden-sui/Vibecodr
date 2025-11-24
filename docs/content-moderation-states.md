# Content Moderation States Specification

**Version:** 1.0  
**Last Updated:** 2025-11-24  
**Status:** Canonical Definition

---

## Overview

This document defines the three content safety states used across Vibecodr. All surfaces (API, web, moderation tools) MUST implement these states consistently.

---

## State Definitions

### 1. ALLOW (`action: "allow"`)

**Database:** `quarantined = 0` or `NULL`  
**HTTP Response:** 200 OK (normal)

| Aspect | Behavior |
|--------|----------|
| **Feed visibility** | Appears in all feeds (home, discover, following, profile) |
| **Direct access** | Accessible via direct URL |
| **Embed** | Embeddable on external sites |
| **Search** | Indexed and searchable |
| **Owner notification** | None |
| **Moderation queue** | Not queued |

**Trigger:** Safety check returns `risk_level: "low"` with no pattern matches.

---

### 2. QUARANTINE (`action: "quarantine"`)

**Database:** `quarantined = 1`, `quarantine_reason` set, `quarantined_at` timestamp  
**HTTP Response:** 200 OK (content returned but flagged)

| Aspect | Behavior |
|--------|----------|
| **Feed visibility** | **HIDDEN** from all public feeds |
| **Direct access** | **ALLOWED** - owner and moderators can view via direct URL |
| **Embed** | **BLOCKED** - returns 403 for embed requests |
| **Search** | **EXCLUDED** from search results |
| **Owner notification** | Show banner: "This content is under review" |
| **Moderation queue** | Appears in `/moderation/flagged` for review |

**Triggers:**
- Auto-quarantine on publish: suspicious patterns detected (see `QUARANTINE_PATTERNS`)
- Manual moderation: `POST /moderation/posts/:id/action { action: "quarantine" }`
- Report resolution: `POST /moderation/reports/:id/resolve { action: "quarantine" }`

**Quarantine Patterns (medium confidence):**
```javascript
/child_process|exec|spawn|fork/i
/fs\./i
/eval|new Function/i
/process\.env/i
/fetch|axios|http\.request|net\.connect/i
/atob\(|Buffer\.from\(.*base64/i
```

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
- High-risk pattern match (see `BLOCK_PATTERNS`)

**Block Patterns (high confidence, severe violations):**
```javascript
/stratum\+tcp|xmrig|cryptonight|coinhive/i  // Crypto-miners
/while\s*\(true\)|for\s*\(\s*;\s*;\s*\)/i   // Infinite loops
```

---

## State Transitions

```
┌─────────────────────────────────────────────────────────────┐
│                      PUBLISH FLOW                           │
└─────────────────────────────────────────────────────────────┘

  [User uploads capsule]
           │
           ▼
  ┌─────────────────┐
  │  Safety Check   │
  └─────────────────┘
           │
    ┌──────┼──────────┐
    │      │          │
    ▼      ▼          ▼
 ALLOW  QUARANTINE  BLOCK
    │      │          │
    ▼      ▼          ▼
 [Save]  [Save +    [Reject
         flag=1]    403]


┌─────────────────────────────────────────────────────────────┐
│                    MODERATION FLOW                          │
└─────────────────────────────────────────────────────────────┘

  [ALLOW]  ──────────────────────────────────────►  [QUARANTINE]
              POST /moderation/posts/:id/action
              { action: "quarantine" }

  [QUARANTINE]  ──────────────────────────────────►  [ALLOW]
              POST /moderation/posts/:id/action
              { action: "unquarantine" }

  [QUARANTINE]  ──────────────────────────────────►  [DELETED]
              POST /moderation/posts/:id/action
              { action: "remove" }

  [ALLOW]  ──────────────────────────────────────►  [DELETED]
              POST /moderation/posts/:id/action
              { action: "remove" }
```

---

## API Surface Behavior

### Feed Endpoints

| Endpoint | Quarantined Content |
|----------|---------------------|
| `GET /posts` (home feed) | **Excluded** |
| `GET /posts/discover` | **Excluded** for users, **Included** for mods |
| `GET /posts?mode=following` | **Excluded** |
| `GET /users/:id/posts` | **Excluded** |

**Implementation:** All feed queries include `WHERE (quarantined IS NULL OR quarantined = 0)`

### Direct Access Endpoints

| Endpoint | Quarantined Content |
|----------|---------------------|
| `GET /capsules/:id` | **Returned** only to owner/moderator with `moderation.state: "quarantine"`; **404** for others |
| `GET /capsules/:id/verify` | **Returned** only to owner/moderator; includes `moderation.state`; **404** for others |
| `GET /posts/:id` | **Returned** with `quarantined: true` flag |
| `GET /capsules/:id/manifest` | **Returned** if owner or mod (see `authorizeCapsuleRequest`) |
| `GET /artifacts/:id/bundle` | **Returned** (no quarantine check on raw bundle) |

### Embed Endpoints

| Endpoint | Quarantined Content |
|----------|---------------------|
| `GET /e/:postId` | **403 Forbidden** |
| `embed.js` iframe | **403 Forbidden** |

---

## Moderation API

### Quarantine a Post
```http
POST /moderation/posts/:postId/action
Authorization: Bearer <mod_token>
Content-Type: application/json

{
  "action": "quarantine",
  "notes": "Suspicious network calls detected"
}
```

### Unquarantine a Post (Escape Hatch)
```http
POST /moderation/posts/:postId/action
Authorization: Bearer <mod_token>
Content-Type: application/json

{
  "action": "unquarantine",
  "notes": "False positive - fetch is for public API"
}
```

### Remove a Post (Hard Delete)
```http
POST /moderation/posts/:postId/action
Authorization: Bearer <mod_token>
Content-Type: application/json

{
  "action": "remove",
  "notes": "Confirmed malicious after manual review"
}
```

---

## Audit Trail

All moderation actions are logged to `moderation_audit_log`:

```sql
CREATE TABLE moderation_audit_log (
  id TEXT PRIMARY KEY,
  moderator_id TEXT NOT NULL,
  action TEXT NOT NULL,        -- 'quarantine' | 'unquarantine' | 'remove' | 'dismiss'
  target_type TEXT NOT NULL,   -- 'post' | 'comment' | 'capsule'
  target_id TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

---

## User-Visible Messages

### On Publish (Quarantine)
```
Your vibe has been published but is currently under review.
It won't appear in feeds until approved.
You can still access it directly and share the link.
```

### On Publish (Block)
```
Unable to publish: Content rejected
Reason: [reason from verdict]
Error code: E-VIBECODR-SECURITY-BLOCK
```

### Owner Viewing Quarantined Content
```
⚠️ This content is under review
It is not visible in public feeds.
Contact support if you believe this is an error.
```

---

## Gaps to Address

### Current Gaps (Needs Implementation)

1. **Capsule-level quarantine** - Currently only posts have `quarantined` column. Capsules set `quarantined` on publish but queries don't filter by it.

2. **User notification** - No system to notify users when their content is quarantined or unquarantined.

3. **Appeal flow** - No self-service appeal mechanism for quarantined content.

4. **Embed blocking** - Embed endpoint needs explicit quarantine check.

5. **Analytics dashboard** - No visibility into quarantine rates, false positive rates, or moderator actions.

### Recommended Schema Addition

```sql
-- Add to capsules table if not exists
ALTER TABLE capsules ADD COLUMN quarantined INTEGER DEFAULT 0;
ALTER TABLE capsules ADD COLUMN quarantine_reason TEXT;
ALTER TABLE capsules ADD COLUMN quarantined_at INTEGER;

-- Index for efficient feed filtering
CREATE INDEX IF NOT EXISTS idx_posts_quarantined ON posts(quarantined);
CREATE INDEX IF NOT EXISTS idx_capsules_quarantined ON capsules(quarantined);
```

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

---

## Implementation Checklist

- [x] `SafetyAction` type defined (`allow` | `quarantine` | `block`)
- [x] Quarantine patterns vs block patterns separated
- [x] Auto-quarantine on publish (`capsules.ts`)
- [x] Feed filtering excludes quarantined posts (`posts.ts`)
- [x] Moderation quarantine/unquarantine endpoints (`moderation.ts`)
- [x] Audit log for moderation actions
- [x] Capsule-level quarantine filtering
- [ ] Embed endpoint quarantine check
- [ ] User notification on quarantine
- [ ] Owner-visible banner for quarantined content
- [ ] Appeal workflow
- [ ] Capsule-level quarantine filtering
