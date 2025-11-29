import type { Handler, Env } from "../types";
import { requireAdmin } from "../auth";
import {
  ERROR_RUNTIME_ANALYTICS_FAILED,
  ERROR_RUNTIME_ANALYTICS_SUMMARY_FAILED,
} from "@vibecodr/shared";
import { json } from "../lib/responses";
import { hashToShard } from "../lib/sharding";

type RateLimitState = {
  tokens: number;
  lastRefill: number;
};

export const RATE_LIMIT_CAPACITY = 120;
// WHY: Refill 2 tokens per second = 120/minute sustained rate.
// Previous value (60s per token) was too restrictive for normal feed usage.
export const RATE_LIMIT_REFILL_INTERVAL_MS = 500;
export const RATE_LIMIT_MAX_KEYS = 1000;
const analyticsRateLimitState = new Map<string, RateLimitState>();
const TRUSTED_CLIENT_IP_HEADERS = ["cf-connecting-ip", "true-client-ip"];
export const RUNTIME_EVENT_MAX_BYTES = 124 * 1024; // 124KB guard for runtime event POST bodies
const RUNTIME_EVENT_MAX_EVENT_LENGTH = 256;
const RUNTIME_EVENT_MAX_MESSAGE_LENGTH = 4000;
const RUNTIME_EVENT_MAX_CODE_LENGTH = 4000;
export const RUNTIME_EVENT_PROPERTIES_MAX_BYTES = 32 * 1024;
export const RUNTIME_EVENT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type RuntimeEventMode = "primary" | "shadow" | "off";

type QueuedRuntimeEvent = {
  id: string;
  event: string;
  capsuleId: string | null;
  artifactId: string | null;
  runnerType: string | null;
  runtimeVersion: string | null;
  code: string | null;
  message: string | null;
  properties: string | null;
  timestampMs: number;
};

function getRuntimeEventMode(env: Env): RuntimeEventMode {
  const raw = String(env.RUNTIME_EVENT_DO_MODE ?? "primary").trim().toLowerCase();
  if (raw === "shadow") return "shadow";
  if (raw === "off" || raw === "legacy" || raw === "disabled") return "off";
  return "primary";
}

function getRuntimeEventStub(env: Env, shardKey: string): DurableObjectStub | null {
  if (!env.RUNTIME_EVENT_SHARD) return null;
  try {
    const shardName = hashToShard(shardKey);
    const id = env.RUNTIME_EVENT_SHARD.idFromName(shardName);
    return env.RUNTIME_EVENT_SHARD.get(id);
  } catch (err) {
    console.error("E-VIBECODR-2137 runtime event DO shard resolve failed", {
      shardKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function enqueueRuntimeEvent(
  env: Env,
  event: QueuedRuntimeEvent
): Promise<{ delivered: boolean; mode: RuntimeEventMode }> {
  const mode = getRuntimeEventMode(env);
  if (!env.RUNTIME_EVENT_SHARD || mode === "off") {
    return { delivered: false, mode };
  }

  const shardKey = event.artifactId || event.capsuleId || event.event || "runtime-event";
  const stub = getRuntimeEventStub(env, shardKey);
  if (!stub) {
    return { delivered: false, mode };
  }

  try {
    const res = await stub.fetch("https://do/runtime-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      console.error("E-VIBECODR-2138 runtime event DO enqueue rejected", {
        status: res.status,
        shardKey,
      });
      return { delivered: false, mode };
    }
    return { delivered: true, mode };
  } catch (err) {
    console.error("E-VIBECODR-2138 runtime event DO enqueue failed", {
      shardKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return { delivered: false, mode };
  }
}

function refillTokens(state: RateLimitState, now: number) {
  const delta = now - state.lastRefill;
  if (delta <= 0) return;
  const intervals = Math.floor(delta / RATE_LIMIT_REFILL_INTERVAL_MS);
  if (intervals > 0) {
    state.tokens = Math.min(RATE_LIMIT_CAPACITY, state.tokens + intervals);
    state.lastRefill += intervals * RATE_LIMIT_REFILL_INTERVAL_MS;
  }
}

// SAFETY: Bound bucket cardinality to prevent unbounded memory if key source misbehaves.
function evictOldestRateLimitBucket(excludeKey: string) {
  if (analyticsRateLimitState.size < RATE_LIMIT_MAX_KEYS) return;
  if (analyticsRateLimitState.has(excludeKey)) return;

  let oldestKey: string | null = null;
  let oldestRefill = Number.POSITIVE_INFINITY;

  for (const [key, state] of analyticsRateLimitState) {
    if (state.lastRefill < oldestRefill) {
      oldestKey = key;
      oldestRefill = state.lastRefill;
    }
  }

  if (oldestKey) {
    analyticsRateLimitState.delete(oldestKey);
  }
}

export function consumeRateLimit(key: string): boolean {
  const now = Date.now();
  evictOldestRateLimitBucket(key);
  const state = analyticsRateLimitState.get(key) ?? {
    tokens: RATE_LIMIT_CAPACITY,
    lastRefill: now,
  };

  refillTokens(state, now);

  if (state.tokens <= 0) {
    analyticsRateLimitState.set(key, state);
    return false;
  }

  state.tokens -= 1;
  analyticsRateLimitState.set(key, state);
  return true;
}

type RuntimeEventPayload = {
  event?: string;
  capsuleId?: string | null;
  artifactId?: string | null;
  runtimeType?: string | null;
  runtimeVersion?: string | null;
  message?: string | null;
  code?: string | null;
  properties?: Record<string, unknown>;
  timestamp?: number;
};

// INVARIANT: Rate limit key uses Cloudflare-assigned IP only to prevent spoofing via user headers.
export function getClientIp(req: Request) {
  for (const header of TRUSTED_CLIENT_IP_HEADERS) {
    const forwarded = req.headers.get(header);
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }
  }
  return "unknown";
}

export function resetAnalyticsRateLimitState() {
  analyticsRateLimitState.clear();
}

export function getRateLimitBucketCount() {
  return analyticsRateLimitState.size;
}

function parseContentLength(header: string | null): number | null {
  if (!header) return null;
  const declared = Number(header);
  if (!Number.isFinite(declared) || declared < 0) return null;
  return declared;
}

type ParseResult =
  | { ok: true; body: RuntimeEventPayload }
  | { ok: false; response: Response };

// SAFETY: Stop decoding once body size exceeds the hard cap to prevent D1/AE blowups.
async function readRuntimeEventBody(req: Request): Promise<ParseResult> {
  const declaredLength = parseContentLength(req.headers.get("content-length"));
  if (declaredLength && declaredLength > RUNTIME_EVENT_MAX_BYTES) {
    return {
      ok: false,
      response: json(
        {
          error: "Payload too large",
          code: "E-VIBECODR-2133",
          maxBytes: RUNTIME_EVENT_MAX_BYTES,
          hint: "Runtime events accept diagnostic JSON only. Upload bundles via artifact endpoints.",
        },
        413
      ),
    };
  }

  const reader = req.body?.getReader();
  if (!reader) {
    return { ok: true, body: {} };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > RUNTIME_EVENT_MAX_BYTES) {
      try {
        await reader.cancel("runtime event payload exceeded limit");
      } catch {
        // ignore reader cancellation failures
      }
      return {
        ok: false,
        response: json(
          {
            error: "Payload too large",
            code: "E-VIBECODR-2133",
            maxBytes: RUNTIME_EVENT_MAX_BYTES,
            hint: "Runtime events accept diagnostic JSON only. Upload bundles via artifact endpoints.",
          },
          413
        ),
      };
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed = JSON.parse(decoder.decode(merged)) as RuntimeEventPayload;
    return { ok: true, body: parsed };
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON body" }, 400) };
  }
}

function limitString(value: unknown, maxLength: number, trim = false): string | null {
  if (typeof value !== "string") return null;
  const normalized = trim ? value.trim() : value;
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  const sliceLength = Math.max(0, maxLength - 3);
  return `${normalized.slice(0, sliceLength)}...`;
}

function clampJsonSize(rawJson: string, maxBytes: number): { json: string; truncated: boolean; originalBytes: number } {
  const rawBytes = encoder.encode(rawJson);
  if (rawBytes.byteLength <= maxBytes) {
    return { json: rawJson, truncated: false, originalBytes: rawBytes.byteLength };
  }

  const minimal = { truncated: true, totalBytes: rawBytes.byteLength };
  const minimalJson = JSON.stringify(minimal);
  const minimalBytes = encoder.encode(minimalJson).byteLength;

  let previewBudget = Math.max(0, maxBytes - minimalBytes - 16);
  let preview = previewBudget > 0 ? decoder.decode(rawBytes.slice(0, previewBudget)) : "";
  let constrained = JSON.stringify({ ...minimal, preview });

  while (encoder.encode(constrained).byteLength > maxBytes && previewBudget > 0) {
    previewBudget = Math.max(0, previewBudget - 256);
    preview = previewBudget > 0 ? decoder.decode(rawBytes.slice(0, previewBudget)) : "";
    constrained = JSON.stringify({ ...minimal, preview });
  }

  if (encoder.encode(constrained).byteLength > maxBytes) {
    constrained = minimalJson;
  }

  return { json: constrained, truncated: true, originalBytes: rawBytes.byteLength };
}

function serializeProperties(properties: unknown): { json: string | null; truncated: boolean; originalBytes: number } {
  if (!properties || typeof properties !== "object") {
    return { json: null, truncated: false, originalBytes: 0 };
  }

  try {
    const rawJson = JSON.stringify(properties);
    return clampJsonSize(rawJson, RUNTIME_EVENT_PROPERTIES_MAX_BYTES);
  } catch (error) {
    const fallback = {
      truncated: true,
      error: "E-VIBECODR-2134 properties not serializable",
      detail: error instanceof Error ? error.message : String(error),
    };
    const fallbackJson = JSON.stringify(fallback);
    const encoded = encoder.encode(fallbackJson);
    return { json: fallbackJson, truncated: true, originalBytes: encoded.byteLength };
  }
}

// INVARIANT: Runtime event timestamps stay within allowed clock skew to avoid corrupting aggregates.
function normalizeEventTimestamp(timestamp: unknown, now: number): { ok: true; timestampMs: number } | { ok: false; response: Response } {
  const candidate = typeof timestamp === "number" ? timestamp : now;
  if (!Number.isFinite(candidate)) {
    return {
      ok: false,
      response: json({ error: "Invalid timestamp", code: "E-VIBECODR-2135" }, 400),
    };
  }

  const minAllowed = now - RUNTIME_EVENT_MAX_CLOCK_SKEW_MS;
  const maxAllowed = now + RUNTIME_EVENT_MAX_CLOCK_SKEW_MS;
  const clamped = Math.min(Math.max(candidate, minAllowed), maxAllowed);

  if (clamped !== candidate) {
    return {
      ok: false,
      response: json(
        {
          error: "Timestamp outside allowed clock skew",
          code: "E-VIBECODR-2135",
          hint: `Provide timestamps within ${Math.round(RUNTIME_EVENT_MAX_CLOCK_SKEW_MS / 60000)} minutes of server time.`,
        },
        400
      ),
    };
  }

  return { ok: true, timestampMs: clamped };
}

function isErrorEvent(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("error") || normalized.includes("violation") || normalized.includes("fail");
}

const ERROR_EVENT_SQL_CLAUSE =
  "LOWER(event_name) LIKE '%error%' OR LOWER(event_name) LIKE '%violation%' OR LOWER(event_name) LIKE '%fail%'";
const DEFAULT_ERROR_RATE_MIN_TOTAL = 3;
const COMPLETED_STATUS_PATTERN = '%"status":"completed"%';
const FIVE_XX_STATUS_PATTERN = "%status=5%";

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toRate(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  if (!Number.isFinite(numerator) || numerator < 0) return 0;
  return numerator / denominator;
}

type EndpointHealthSnapshot = {
  total: number;
  fiveXx: number;
  rate: number;
};

type RuntimeHealthSnapshot = {
  killed: number;
  completed: number;
  killRate: number;
};

type RuntimeAnalyticsSnapshot = {
  snapshotTime: number;
  summary: Array<{ eventName: string; total: number; lastHour: number; lastDay: number }>;
  recent: Array<{
    eventName: string;
    capsuleId: string | null;
    artifactId: string | null;
    runtimeType: string | null;
    runtimeVersion: string | null;
    code: string | null;
    message: string | null;
    properties: Record<string, unknown> | null;
    createdAt: number;
  }>;
  errorsLastDay: Array<{ eventName: string; count: number }>;
  capsuleErrorRates: Array<{ capsuleId: string; total: number; errors: number; errorRate: number }>;
  capsuleRunVolumes: Array<{ capsuleId: string; totalRuns: number; completedRuns: number; failedRuns: number }>;
  health: {
    endpoints: {
      artifacts: EndpointHealthSnapshot;
      runs: EndpointHealthSnapshot;
      import: EndpointHealthSnapshot;
    };
    runtime: RuntimeHealthSnapshot;
  };
};

async function queryEndpointHealth(
  env: Env,
  sinceDay: number,
  patterns: string[],
  codePrefix?: string
): Promise<{ total: number; fiveXx: number }> {
  const clauses = patterns.map(() => "(LOWER(COALESCE(properties, '')) LIKE ? OR LOWER(COALESCE(message, '')) LIKE ?)");
  const params: string[] = [];
  for (const pattern of patterns) {
    const normalized = `%${pattern.toLowerCase()}%`;
    params.push(normalized, normalized);
  }

  let codeClause = "";
  if (codePrefix) {
    codeClause = " OR LOWER(COALESCE(code, '')) LIKE ?";
    params.push(`${codePrefix.toLowerCase()}%`);
  }

  const whereClause = clauses.length > 0 ? `(${clauses.join(" OR ")}${codeClause})` : `(1 = 1${codeClause})`;

  const { results } = await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN LOWER(COALESCE(message, '')) LIKE ? THEN 1 ELSE 0 END) AS five_xx
    FROM runtime_events
    WHERE event_name = 'client_error'
      AND created_at >= ?
      AND ${whereClause}
    `
  )
    .bind(FIVE_XX_STATUS_PATTERN, sinceDay, ...params)
    .all();

  const row = results?.[0] as { total?: number; five_xx?: number } | undefined;
  const total = toNumber(row?.total);
  const fiveXx = toNumber(row?.five_xx);

  return { total, fiveXx };
}

export async function buildRuntimeAnalyticsSummary(env: Env, options: {
  limit: number;
  recentLimit: number;
  nowMs?: number;
}): Promise<RuntimeAnalyticsSnapshot> {
  const nowMs = options.nowMs ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const sinceHour = nowSec - 3600;
  const sinceDay = nowSec - 86400;
  const { limit, recentLimit } = options;

  const { results: summaryRows } = await env.DB.prepare(
    `
    SELECT
      event_name,
      COUNT(*) as total,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as last_hour,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as last_day
    FROM runtime_events
    GROUP BY event_name
    ORDER BY total DESC
    LIMIT ?
    `
  )
    .bind(sinceHour, sinceDay, limit)
    .all();

  const summary = (summaryRows || []).map((row: any) => ({
    eventName: row.event_name,
    total: Number(row.total ?? 0),
    lastHour: Number(row.last_hour ?? 0),
    lastDay: Number(row.last_day ?? 0),
  }));

  const { results: recentRows } = await env.DB.prepare(
    `
    SELECT
      event_name,
      capsule_id,
      artifact_id,
      runtime_type,
      runtime_version,
      code,
      message,
      properties,
      created_at
    FROM runtime_events
    ORDER BY created_at DESC
    LIMIT ?
    `
  )
    .bind(recentLimit)
    .all();

  const recent = (recentRows || []).map((row: any) => {
    let parsedProperties: Record<string, unknown> | null = null;
    if (typeof row.properties === "string") {
      try {
        parsedProperties = JSON.parse(row.properties);
      } catch {
        parsedProperties = null;
      }
    }

    return {
      eventName: row.event_name,
      capsuleId: row.capsule_id,
      artifactId: row.artifact_id,
      runtimeType: row.runtime_type,
      runtimeVersion: row.runtime_version,
      code: row.code,
      message: row.message,
      properties: parsedProperties,
      createdAt: Number(row.created_at ?? 0) * 1000,
    };
  });

  const { results: errorRows } = await env.DB.prepare(
    `
    SELECT event_name, COUNT(*) AS errors
    FROM runtime_events
    WHERE created_at >= ? AND (${ERROR_EVENT_SQL_CLAUSE})
    GROUP BY event_name
    ORDER BY errors DESC
    LIMIT ?
    `
  )
    .bind(sinceDay, limit)
    .all();

  const errorsLastDay = (errorRows || []).map((row: any) => ({
    eventName: row.event_name,
    count: toNumber(row.errors),
  }));

  const { results: capsuleErrorRows } = await env.DB.prepare(
    `
    SELECT
      capsule_id,
      COUNT(*) AS total,
      SUM(CASE WHEN ${ERROR_EVENT_SQL_CLAUSE} THEN 1 ELSE 0 END) AS errors,
      CASE
        WHEN COUNT(*) > 0 THEN SUM(CASE WHEN ${ERROR_EVENT_SQL_CLAUSE} THEN 1 ELSE 0 END) * 1.0 / COUNT(*)
        ELSE 0
      END AS error_rate
    FROM runtime_events
    WHERE capsule_id IS NOT NULL AND capsule_id != '' AND created_at >= ?
    GROUP BY capsule_id
    HAVING COUNT(*) >= ?
    ORDER BY error_rate DESC, errors DESC
    LIMIT ?
    `
  )
    .bind(sinceDay, DEFAULT_ERROR_RATE_MIN_TOTAL, limit)
    .all();

  const capsuleErrorRates = (capsuleErrorRows || []).map((row: any) => ({
    capsuleId: row.capsule_id as string,
    total: toNumber(row.total),
    errors: toNumber(row.errors),
    errorRate: toNumber(row.error_rate),
  }));

  const { results: runVolumeRows } = await env.DB.prepare(
    `
    SELECT
      capsule_id,
      COUNT(*) AS total_runs,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_runs,
      SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END) AS failed_runs
    FROM runs
    WHERE capsule_id IS NOT NULL AND capsule_id != '' AND started_at >= ?
    GROUP BY capsule_id
    ORDER BY total_runs DESC
    LIMIT ?
    `
  )
    .bind(sinceDay, limit)
    .all();

  const capsuleRunVolumes = (runVolumeRows || []).map((row: any) => ({
    capsuleId: row.capsule_id as string,
    totalRuns: toNumber(row.total_runs),
    completedRuns: toNumber(row.completed_runs),
    failedRuns: toNumber(row.failed_runs),
  }));

  const { results: runtimeOutcomeRows } = await env.DB.prepare(
    `
    SELECT
      SUM(CASE WHEN event_name = 'runtime_killed' THEN 1 ELSE 0 END) AS killed,
      SUM(
        CASE
          WHEN event_name = 'player_run_completed' AND COALESCE(properties, '') LIKE ? THEN 1
          ELSE 0
        END
      ) AS completed
    FROM runtime_events
    WHERE created_at >= ?
    `
  )
    .bind(COMPLETED_STATUS_PATTERN, sinceDay)
    .all();

  const runtimeOutcome = (runtimeOutcomeRows || [])[0] as { killed?: number; completed?: number } | undefined;
  const runtimeKilled = toNumber(runtimeOutcome?.killed);
  const runtimeCompleted = toNumber(runtimeOutcome?.completed);
  const runtimeHealth: RuntimeHealthSnapshot = {
    killed: runtimeKilled,
    completed: runtimeCompleted,
    killRate: toRate(runtimeKilled, runtimeKilled + runtimeCompleted),
  };

  const [artifactsHealth, runsHealth, importHealth] = await Promise.all([
    queryEndpointHealth(env, sinceDay, ["artifact"], "e-vibecodr-11"),
    queryEndpointHealth(env, sinceDay, ["run"], "e-vibecodr-06"),
    queryEndpointHealth(env, sinceDay, ["import"], "e-vibecodr-08"),
  ]);

  const endpoints = {
    artifacts: {
      total: artifactsHealth.total,
      fiveXx: artifactsHealth.fiveXx,
      rate: toRate(artifactsHealth.fiveXx, artifactsHealth.total),
    },
    runs: {
      total: runsHealth.total,
      fiveXx: runsHealth.fiveXx,
      rate: toRate(runsHealth.fiveXx, runsHealth.total),
    },
    import: {
      total: importHealth.total,
      fiveXx: importHealth.fiveXx,
      rate: toRate(importHealth.fiveXx, importHealth.total),
    },
  };

  return {
    snapshotTime: nowMs,
    summary,
    recent,
    errorsLastDay,
    capsuleErrorRates,
    capsuleRunVolumes,
    health: {
      endpoints,
      runtime: runtimeHealth,
    },
  };
}

export const recordRuntimeEvent: Handler = async (req, env) => {
  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  const clientIp = getClientIp(req);
  if (!consumeRateLimit(clientIp)) {
    console.warn("E-VIBECODR-2132 runtime analytics rate limit exceeded", { ip: clientIp });
    return json({ error: "Rate limit exceeded" }, 429);
  }

  const parsedBody = await readRuntimeEventBody(req);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.body;

  const event = limitString(typeof body.event === "string" ? body.event : "", RUNTIME_EVENT_MAX_EVENT_LENGTH, true) ?? "";
  if (!event) {
    return json({ error: "event name is required" }, 400);
  }

  const now = Date.now();
  const normalizedTimestamp = normalizeEventTimestamp(body.timestamp, now);
  if (!normalizedTimestamp.ok) {
    return normalizedTimestamp.response;
  }
  const timestamp = normalizedTimestamp.timestampMs;
  const createdAt = Math.floor(timestamp / 1000);
  const message = limitString(body.message, RUNTIME_EVENT_MAX_MESSAGE_LENGTH) ?? null;
  const code = limitString(body.code, RUNTIME_EVENT_MAX_CODE_LENGTH) ?? null;
  const { json: properties, truncated: propertiesTruncated, originalBytes } = serializeProperties(body.properties);

  if (propertiesTruncated) {
    console.warn("E-VIBECODR-2134 runtime event properties truncated", {
      event,
      originalBytes,
      cappedBytes: RUNTIME_EVENT_PROPERTIES_MAX_BYTES,
    });
  }

  const eventId = crypto.randomUUID();
  const queuedEvent: QueuedRuntimeEvent = {
    id: eventId,
    event,
    capsuleId: body.capsuleId || null,
    artifactId: body.artifactId || null,
    runnerType: body.runtimeType || null,
    runtimeVersion: body.runtimeVersion || null,
    code,
    message,
    properties: properties,
    timestampMs: timestamp,
  };

  const dispatchResult = await enqueueRuntimeEvent(env, queuedEvent);
  const shouldWriteInline = dispatchResult.mode === "shadow" || !dispatchResult.delivered;

  if (shouldWriteInline) {
    try {
      await env.DB.prepare(
        `
        INSERT INTO runtime_events (
          id,
          event_name,
          capsule_id,
          artifact_id,
          runtime_type,
          runtime_version,
          code,
          message,
          properties,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
        .bind(
          queuedEvent.id,
          queuedEvent.event,
          queuedEvent.capsuleId,
          queuedEvent.artifactId,
          queuedEvent.runnerType,
          queuedEvent.runtimeVersion,
          queuedEvent.code,
          queuedEvent.message,
          queuedEvent.properties,
          createdAt
        )
        .run();
    } catch (error) {
      console.error(ERROR_RUNTIME_ANALYTICS_FAILED, {
        error: error instanceof Error ? error.message : String(error),
        event,
        capsuleId: body.capsuleId,
        artifactId: body.artifactId,
      });
      return json(
        {
          error: "Failed to record runtime event",
          code: ERROR_RUNTIME_ANALYTICS_FAILED,
          retryable: true,
        },
        500
      );
    }
  }

  if (env.vibecodr_analytics_engine && typeof env.vibecodr_analytics_engine.writeDataPoint === "function") {
    try {
      env.vibecodr_analytics_engine.writeDataPoint({
        blobs: [
          event,
          body.capsuleId ?? "",
          body.artifactId ?? "",
          body.runtimeType ?? "",
          body.runtimeVersion ?? "",
          code ?? "",
          message ?? "",
        ],
        doubles: [timestamp, isErrorEvent(event) ? 1 : 0],
        indexes: [body.artifactId ?? body.capsuleId ?? ""],
      });
    } catch (error) {
      console.error(ERROR_RUNTIME_ANALYTICS_FAILED, {
        error: error instanceof Error ? error.message : String(error),
        event,
      });
    }
  }

  return json({ ok: true }, 202);
};

export const getRuntimeAnalyticsSummary: Handler = requireAdmin(async (req, env) => {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? "20")));
  const recentLimit = Math.max(1, Math.min(50, Number(url.searchParams.get("recentLimit") ?? "20")));

  try {
    const snapshot = await buildRuntimeAnalyticsSummary(env, { limit, recentLimit });
    return json(snapshot);
  } catch (error) {
    console.error(ERROR_RUNTIME_ANALYTICS_SUMMARY_FAILED, {
      error: error instanceof Error ? error.message : String(error),
    });
    return json(
      {
        error: "Failed to fetch runtime analytics summary",
      },
      500
    );
  }
});
