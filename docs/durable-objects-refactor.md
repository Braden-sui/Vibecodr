# Durable Objects Refactor (Runtime + Hot Counters)

## Goal
Move hot, contention-prone D1 writes to Durable Object (DO) sharded buffers to avoid SQLite lock contention, batch writes safely, and enforce rate limits without WAF dependence.

## Scope (current truth)
- Proxy rate limits: DO front for user/ip/host buckets; D1 fallback; KV/in-memory only as last-resort during outages.
- Runtime telemetry ingest: DO batches to D1 `runtime_events` + Analytics Engine; handler uses DO as primary, falls back inline on failure.
- Social/run counters: DO buffers per post/user hash shard, flushes deltas to D1; shadow mode exercises DO but writes via legacy path to avoid double increments.
- Quota/accounting reads: deferred (still direct D1 reads today).

## Architecture (as built)
- Sharding: `hashToShard(key) % 32`, `idFromName(shard)` per namespace.
- Pipelines:
  - Rate limits: `proxy.ts` → `RateLimitShard.fetch` → DO storage window counters → D1 fallback (`proxy_rate_limits`) → KV fallback.
  - Runtime events: handler builds normalized event (single UUID), sends to `RuntimeEventShard`; DO batches, flushes on size>=100 or 5s alarm, writes D1 + AE, `ON CONFLICT(id) DO NOTHING` to support shadow inline writes.
  - Counters: handlers call `incrementPostStats`/`incrementUserCounters` → `CounterShard` (hash by postId/userId); DO buffers deltas, flushes on alarm with clamped updates; shadow mode sends no-op to DO and uses legacy D1 update.
- Durability/flush: alarms scheduled after each enqueue; backoff 1s on failure; flush logs include shard, counts, duration (`E-VIBECODR-2130/2131` runtime events, `E-VIBECODR-2140/2141` counters).
- Error codes: DO enqueue failures logged (`E-VIBECODR-2137/2138` runtime events, `E-VIBECODR-2144/2145` counters); proxy fallback logs reuse `E-VIBECODR-0308/0310`.

## Checklist (completed)
- [x] Inventory hot paths and add DO bindings (`RATE_LIMIT_SHARD`, `RUNTIME_EVENT_SHARD`, `COUNTER_SHARD`) + Env typing.
- [x] Implement DO classes with alarms/backoff + observability.
  - [x] `RateLimitShard`: sliding window, sharded; used by proxy before D1/KV fallback.
  - [x] `RuntimeEventShard`: batch/flush with AE emit; alarm-driven; dedupe via event id.
  - [x] `CounterShard`: buffered deltas; alarm flush to D1; shadow mode acknowledged without persistence.
- [x] Handler integrations
  - [x] Proxy rate limit path now DO-first (D1 then KV fallback).
  - [x] Runtime events go through DO; inline D1 write only on shadow/fail.
  - [x] Social/runs counter increments routed through DO; legacy D1 used only on shadow/fail.
- [x] Observability: structured logs on DO flush/fail; error codes tagged.
- [x] Tests/fakes: vitest coverage for DO classes and handler dispatch.
- [x] Rollout levers: env flags + shadow safety
  - `RUNTIME_EVENT_DO_MODE`: `primary` (default), `shadow` (also inline write, deduped by id), `off` (legacy only).
  - `COUNTER_DO_MODE`: `primary` (default), `shadow` (DO no-op + legacy write), `off` (legacy only).
  - Hash shard count fixed at 32; adjust in code if required.
- [x] Docs/runbooks updated (this file) to reflect live behavior.

## Current state
- DO implementations: `workers/api/src/durable/{RateLimitShard,RuntimeEventShard,CounterShard}.ts` with alarms and backoff.
- Handler wiring: `proxy.ts` (DO-first limits), `runtimeEvents.ts` (DO enqueue + fallback), `counters.ts` (DO-backed increments used by social/runs).
- Env defaults: `RUNTIME_EVENT_DO_MODE=primary`, `COUNTER_DO_MODE=primary` in `workers/api/wrangler.toml`.
- Tests executed: `pnpm -C workers/api test runtimeEvents counters durable` (vitest) ✅.

## Rollout/operations
- Enable/disable via env flags above; no double writes in primary mode. Shadow mode safe for validation (runtime events dedupe by id; counters DO acknowledges but does not persist).
- Flush cadence: 5s alarms (runtime events & counters); retry alarms every 1s on failures.
- Rate limit storage order: DO → D1 (`proxy_rate_limits`) → KV/in-memory. Keep KV available for outage resilience.
- Reconciliation: existing `reconcileCounters` cron remains as safety net. No DO read caches yet (quota caching deferred).
