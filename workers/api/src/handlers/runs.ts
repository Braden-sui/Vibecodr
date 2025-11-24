import type { Env, Handler } from "../types";
import { requireAuth, type AuthenticatedUser } from "../auth";
import { incrementPostStats, incrementUserCounters, runCounterUpdate } from "./counters";
import { getUserRunQuotaState, Plan } from "../storage/quotas";
import { json } from "../lib/responses";

const DEFAULT_MAX_CONCURRENT_ACTIVE = 2;
const DEFAULT_RUNTIME_SESSION_MAX_MS = 60_000;
const ERROR_RUN_LOG_ANALYTICS_FAILED = "E-VIBECODR-2136";

type AuthedHandler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  user: AuthenticatedUser
) => Promise<Response>;

type RunRow = {
  id: string;
  capsule_id: string;
  post_id: string | null;
  user_id: string | null;
  started_at: number | null;
};

function parseRuntimeLimits(env: Env): { maxConcurrent: number; maxSessionMs: number } {
  const maxConcurrentRaw = Number(env.RUNTIME_MAX_CONCURRENT_ACTIVE ?? DEFAULT_MAX_CONCURRENT_ACTIVE);
  const sessionMsRaw = Number(env.RUNTIME_SESSION_MAX_MS ?? DEFAULT_RUNTIME_SESSION_MAX_MS);

  const maxConcurrent = Number.isFinite(maxConcurrentRaw)
    ? Math.min(Math.max(Math.trunc(maxConcurrentRaw), 1), 10)
    : DEFAULT_MAX_CONCURRENT_ACTIVE;
  const maxSessionMs = Number.isFinite(sessionMsRaw)
    ? Math.min(Math.max(Math.trunc(sessionMsRaw), 1_000), 300_000)
    : DEFAULT_RUNTIME_SESSION_MAX_MS;

  return { maxConcurrent, maxSessionMs };
}

function getActiveWindowSeconds(maxSessionMs: number): number {
  return Math.max(120, Math.ceil(maxSessionMs / 1000) * 2);
}

async function findRunById(env: Env, runId: string): Promise<RunRow | null> {
  const { results } = await env.DB.prepare(
    "SELECT id, capsule_id, post_id, user_id, started_at FROM runs WHERE id = ? LIMIT 1"
  )
    .bind(runId)
    .all();

  const row = results?.[0] as
    | {
        id?: string;
        capsule_id?: string;
        post_id?: string | null;
        user_id?: string | null;
        started_at?: number | null;
      }
    | undefined;

  if (!row || !row.id || !row.capsule_id) {
    return null;
  }

  return {
    id: row.id,
    capsule_id: row.capsule_id,
    post_id: row.post_id ?? null,
    user_id: row.user_id ?? null,
    started_at:
      typeof row.started_at === "number" && Number.isFinite(row.started_at)
        ? row.started_at
        : null,
  };
}

async function countActiveRuns(env: Env, userId: string, windowSeconds: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT COUNT(*) as count
     FROM runs
     WHERE user_id = ?
       AND status = 'started'
       AND started_at >= strftime('%s','now') - ?`
  )
    .bind(userId, windowSeconds)
    .all();

  const row = results?.[0] as { count?: number } | undefined;
  return Number.isFinite(row?.count) ? Number(row?.count ?? 0) : 0;
}

function quotaExceededResponse(
  quota: Awaited<ReturnType<typeof getUserRunQuotaState>>,
  code: string
): Response {
  const usage =
    quota.result.usage ??
    ({ bundleSize: 0, runs: quota.runsThisMonth, storage: 0, liveMinutes: 0 } as const);

  return json(
    {
      error: "Run quota exceeded",
      code,
      plan: quota.plan,
      reason: quota.result.reason,
      limits: quota.result.limits,
      usage,
      runsThisMonth: quota.runsThisMonth,
      percentUsed: quota.result.percentUsed ?? null,
    },
    429
  );
}

function normalizeDurationMs(candidate: unknown, startedAtSec: number | null): number | null {
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return Math.max(0, candidate);
  }
  if (startedAtSec) {
    return Math.max(0, Date.now() - startedAtSec * 1000);
  }
  return null;
}

async function incrementRunCounters(ctx: ExecutionContext | null, env: Env, userId: string, postId: string | null, runId: string) {
  await runCounterUpdate(ctx, () => incrementUserCounters(env, userId, { runsDelta: 1 }), {
    code: "E-VIBECODR-0601",
    op: "increment user runs_count",
    details: { userId, runId },
  });

  if (postId) {
    await runCounterUpdate(ctx, () => incrementPostStats(env, postId, { runsDelta: 1 }), {
      code: "E-VIBECODR-0602",
      op: "increment post runs_count",
      details: { postId, runId },
    });
  }
}

function writeRunAnalytics(
  env: Env,
  payload: {
    event: "run_start" | "run_complete";
    status?: "started" | "completed" | "failed" | "killed";
    plan?: Plan;
    runId?: string;
    capsuleId?: string;
    postId?: string | null;
    durationMs?: number | null;
    error?: string | null;
    artifactId?: string | null;
  }
) {
  try {
    const analytics = env.vibecodr_analytics_engine;
    if (!analytics || typeof analytics.writeDataPoint !== "function") return;
    analytics.writeDataPoint({
      blobs: [
        payload.event,
        payload.status ?? "",
        payload.plan ?? "",
        payload.capsuleId ?? "",
        payload.postId ?? "",
        payload.error ?? "",
        payload.artifactId ?? "",
      ],
      doubles: [payload.durationMs ?? 0],
      indexes: [payload.runId ?? payload.artifactId ?? payload.capsuleId ?? ""],
    });
  } catch (err) {
    console.error("E-VIBECODR-0609 run analytics write failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function recordRunQuotaObservation(env: Env, userId: string) {
  try {
    const { plan, runsThisMonth, result } = await getUserRunQuotaState(userId, env);

    try {
      const analytics = env.vibecodr_analytics_engine;
      if (analytics && typeof analytics.writeDataPoint === "function") {
        analytics.writeDataPoint({
          blobs: ["run_quota_observation", plan, userId],
          doubles: [runsThisMonth, result.percentUsed ?? 0],
        });
      }
    } catch (err) {
      console.error("E-VIBECODR-0603 run quota analytics write failed", {
        userId,
        runsThisMonth,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    console.error("E-VIBECODR-0604 run quota snapshot failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * POST /runs/start
 * Body: { capsuleId: string; postId?: string; runId?: string }
 */
const startRunHandler: AuthedHandler = async (req, env, ctx, _params, user) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = payload as {
    capsuleId?: string;
    postId?: string | null;
    runId?: string | null;
    artifactId?: string | null;
  };
  const capsuleId = body.capsuleId?.trim();
  const postId = body.postId?.trim() || null;
  const artifactIdRaw = typeof body.artifactId === "string" ? body.artifactId.trim() : "";
  const artifactId = artifactIdRaw || null;
  const requestedRunId = body.runId?.trim() || null;

  if (!capsuleId) {
    return json({ error: "capsuleId is required" }, 400);
  }

  const runId = requestedRunId || crypto.randomUUID();
  const existingRun = await findRunById(env, runId);
  if (existingRun) {
    if (existingRun.user_id !== user.userId) {
      return json({ error: "Run id is already used by another user" }, 403);
    }
    return json({ ok: true, runId, idempotent: true });
  }

  const limits = parseRuntimeLimits(env);
  const activeWindowSeconds = getActiveWindowSeconds(limits.maxSessionMs);
  const activeRuns = await countActiveRuns(env, user.userId, activeWindowSeconds);
  if (activeRuns >= limits.maxConcurrent) {
    return json(
      {
        error: "Active run limit reached",
        code: "E-VIBECODR-0608",
        limit: limits.maxConcurrent,
        activeRuns,
      },
      429
    );
  }

  const quota = await getUserRunQuotaState(user.userId, env);
  if (!quota.result.allowed) {
    return quotaExceededResponse(quota, "E-VIBECODR-0605");
  }

  try {
    await env.DB.prepare(
      `INSERT INTO runs (id, capsule_id, post_id, user_id, started_at, status)
       VALUES (?, ?, ?, ?, strftime('%s','now'), ?)`
    )
      .bind(runId, capsuleId, postId, user.userId, "started")
      .run();
  } catch (e: any) {
    if (e?.message?.includes("UNIQUE")) {
      const conflictingRun = await findRunById(env, runId);
      if (conflictingRun && conflictingRun.user_id !== user.userId) {
        return json({ error: "Run id is already used by another user" }, 403);
      }
      return json({ ok: true, runId, idempotent: true });
    }
    throw e;
  }

  await incrementRunCounters(ctx, env, user.userId, postId, runId);
  recordRunQuotaObservation(env, user.userId);
  writeRunAnalytics(env, {
    event: "run_start",
    status: "started",
    plan: quota.plan,
    runId,
    capsuleId,
    postId,
    artifactId,
  });

  return json({
    ok: true,
    runId,
    plan: quota.plan,
    limits: quota.result.limits,
    usage:
      quota.result.usage ??
      ({ bundleSize: 0, runs: quota.runsThisMonth, storage: 0, liveMinutes: 0 } as const),
    runsThisMonth: quota.runsThisMonth,
    percentUsed: quota.result.percentUsed ?? null,
  });
};

export const startRun: Handler = requireAuth(startRunHandler);

/**
 * POST /runs/complete
 * Body: { capsuleId: string; postId?: string; runId?: string; durationMs?: number; status?: 'completed'|'failed'; errorMessage?: string }
 */
const completeRunHandler: AuthedHandler = async (req, env, ctx, _params, user) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const limits = parseRuntimeLimits(env);

  try {
    const body = (await req.json()) as {
      capsuleId?: string;
      postId?: string | null;
      runId?: string | null;
      durationMs?: number | null;
      status?: "completed" | "failed";
      errorMessage?: string | null;
      artifactId?: string | null;
    };

    const capsuleId = body.capsuleId?.trim();
    const postId = body.postId?.trim() || null;
    const artifactIdRaw = typeof body.artifactId === "string" ? body.artifactId.trim() : "";
    const artifactId = artifactIdRaw || null;
    const status = body.status === "failed" ? "failed" : "completed";
    const errorMessage = status === "failed" ? (body.errorMessage || null) : null;

    if (!capsuleId) {
      return json({ error: "capsuleId is required" }, 400);
    }

    const runId = (body.runId && body.runId.trim()) || crypto.randomUUID();

    const existingRun = await findRunById(env, runId);
    if (existingRun) {
      if (existingRun.user_id !== user.userId) {
        return json({ error: "Run id is already used by another user" }, 403);
      }
      if (existingRun.capsule_id !== capsuleId) {
        return json({ error: "capsuleId does not match run" }, 400);
      }
      if (existingRun.post_id && postId && existingRun.post_id !== postId) {
        return json({ error: "postId does not match run" }, 400);
      }

      const durationMs = normalizeDurationMs(body.durationMs, existingRun.started_at);
      const budgetExceeded =
        durationMs != null && Number.isFinite(durationMs) && durationMs > limits.maxSessionMs;
      const cappedDuration = durationMs != null ? Math.min(durationMs, limits.maxSessionMs) : durationMs;
      const finalStatus = budgetExceeded ? "failed" : status;
      const finalError = budgetExceeded ? "runtime_budget_exceeded" : errorMessage;
      try {
        await env.DB.prepare(
          `UPDATE runs
           SET duration_ms = ?, status = ?, error_message = ?, post_id = COALESCE(post_id, ?)
           WHERE id = ?`
        )
          .bind(cappedDuration, finalStatus, finalError, postId, runId)
          .run();
      } catch (err: any) {
        console.error("E-VIBECODR-0606 completeRun update failed", {
          runId,
          userId: user.userId,
          error: err instanceof Error ? err.message : String(err),
        });
        return json({ error: "Failed to log run" }, 500);
      }

      recordRunQuotaObservation(env, user.userId);
      if (budgetExceeded) {
        writeRunAnalytics(env, {
          event: "run_complete",
          status: "killed",
          plan: undefined,
          runId,
          capsuleId,
          postId,
          durationMs: cappedDuration,
          error: "runtime_budget_exceeded",
          artifactId,
        });
        return json(
          {
            error: "Run exceeded max duration",
            code: "E-VIBECODR-0609",
            limitMs: limits.maxSessionMs,
            durationMs,
            runId,
          },
          400
        );
      }
      return json({ ok: true, runId, idempotent: false });
    }

    const quota = await getUserRunQuotaState(user.userId, env);
    if (!quota.result.allowed) {
      return quotaExceededResponse(quota, "E-VIBECODR-0607");
    }

    const durationMs = normalizeDurationMs(body.durationMs, null);
    const budgetExceeded =
      durationMs != null && Number.isFinite(durationMs) && durationMs > limits.maxSessionMs;
    const cappedDuration = durationMs != null ? Math.min(durationMs, limits.maxSessionMs) : durationMs;
    const finalStatus = budgetExceeded ? "failed" : status;
    const finalError = budgetExceeded ? "runtime_budget_exceeded" : errorMessage;

    try {
      await env.DB.prepare(
        `INSERT INTO runs (id, capsule_id, post_id, user_id, started_at, duration_ms, status, error_message)
         VALUES (?, ?, ?, ?, strftime('%s','now'), ?, ?, ?)`
      )
        .bind(runId, capsuleId, postId, user.userId, cappedDuration, finalStatus, finalError)
        .run();
    } catch (e: any) {
      if (e?.message?.includes("UNIQUE")) {
        const conflictingRun = await findRunById(env, runId);
        if (conflictingRun && conflictingRun.user_id !== user.userId) {
          return json({ error: "Run id is already used by another user" }, 403);
        }
        return json({ ok: true, runId, idempotent: true });
      }
      throw e;
    }

    await incrementRunCounters(ctx, env, user.userId, postId, runId);
    recordRunQuotaObservation(env, user.userId);
    writeRunAnalytics(env, {
      event: "run_complete",
      status: finalStatus,
      plan: quota.plan,
      runId,
      capsuleId,
      postId,
      durationMs: cappedDuration,
      error: finalError,
      artifactId,
    });

    if (budgetExceeded) {
      return json(
        {
          error: "Run exceeded max duration",
          code: "E-VIBECODR-0609",
          limitMs: limits.maxSessionMs,
          durationMs,
          runId,
        },
        400
      );
    }

    return json({ ok: true, runId, idempotent: false });
} catch (error) {
  return json(
    { error: "Failed to log run", details: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
};

export const completeRun: Handler = requireAuth(completeRunHandler);

const LOG_LEVELS = new Set(["log", "info", "warn", "error"]);
const MAX_LOGS_PER_REQUEST = 25;

type IncomingLog = {
  level?: string;
  message?: unknown;
  timestamp?: number;
  source?: string;
  sampleRate?: number;
};

type SanitizedLog = {
  level: "log" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
  source: "preview" | "player";
  sampleRate: number;
};

function sanitizeLogs(logs: unknown): SanitizedLog[] {
  if (!Array.isArray(logs)) {
    return [];
  }
  const sanitized: SanitizedLog[] = [];
  for (const raw of logs) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as IncomingLog;
    const normalizedLevel =
      typeof entry.level === "string" && LOG_LEVELS.has(entry.level)
        ? (entry.level as SanitizedLog["level"])
        : "log";
    const message =
      typeof entry.message === "string"
        ? entry.message
        : entry.message != null
        ? JSON.stringify(entry.message)
        : "";
    if (!message) continue;
    const timestamp =
      typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
        ? entry.timestamp
        : Date.now();
    const source =
      entry.source === "preview" || entry.source === "player" ? entry.source : "player";
    const rate =
      typeof entry.sampleRate === "number" && entry.sampleRate > 0
        ? Math.min(entry.sampleRate, 1)
        : 1;
    sanitized.push({
      level: normalizedLevel,
      message: message.slice(0, 500),
      timestamp,
      source,
      sampleRate: rate,
    });
    if (sanitized.length >= MAX_LOGS_PER_REQUEST) {
      break;
    }
  }
  return sanitized;
}

const appendRunLogsHandler: AuthedHandler = async (req, env, _ctx, params, user) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const runId = params.p1;
  if (!runId) {
    return json({ error: "runId is required" }, 400);
  }

  const run = await findRunById(env, runId);
  if (run && run.user_id !== user.userId) {
    return json({ error: "Forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const payload = body as {
    capsuleId?: string;
    postId?: string | null;
    artifactId?: string | null;
    logs?: unknown;
  };

  if (run) {
    if (payload.capsuleId && payload.capsuleId !== run.capsule_id) {
      return json({ error: "capsuleId does not match run" }, 400);
    }
    if (payload.postId && run.post_id && payload.postId !== run.post_id) {
      return json({ error: "postId does not match run" }, 400);
    }
  }

  const logs = sanitizeLogs(payload.logs);
  if (logs.length === 0) {
    return json({ error: "logs array required" }, 400);
  }
  const artifactIdRaw = typeof payload.artifactId === "string" ? payload.artifactId.trim() : "";
  const artifactId = artifactIdRaw || null;

  const dataset = env.vibecodr_analytics_engine;
  if (dataset && typeof dataset.writeDataPoint === "function") {
    for (const entry of logs) {
      try {
        dataset.writeDataPoint({
          indexes: [runId || artifactId || payload.capsuleId || ""],
          blobs: [
            "player_console_log",
            entry.level,
            entry.source,
            entry.message,
            payload.capsuleId || "",
            payload.postId || "",
            artifactId || "",
          ],
          doubles: [entry.timestamp, entry.sampleRate],
        });
      } catch (err) {
        console.error(`${ERROR_RUN_LOG_ANALYTICS_FAILED} appendRunLogs analytics write failed`, {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return json({ ok: true, accepted: logs.length });
};

export const appendRunLogs: Handler = requireAuth(appendRunLogsHandler);
