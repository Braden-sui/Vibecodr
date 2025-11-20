import type { Env } from "../index";
import { incrementPostStats, incrementUserCounters } from "./counters";
import { getUserRunQuotaState } from "../storage/quotas";

type Handler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>
) => Promise<Response>;

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function getAuthUserId(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.replace("Bearer ", "");
}

/**
 * POST /runs/complete
 * Minimal run logging endpoint
 * Body: { capsuleId: string; postId?: string; runId?: string; durationMs?: number; status?: 'completed'|'failed'; errorMessage?: string }
 */
export const completeRun: Handler = async (req, env) => {
  try {
    const body = (await req.json()) as {
      capsuleId?: string;
      postId?: string | null;
      runId?: string | null;
      durationMs?: number | null;
      status?: "completed" | "failed";
      errorMessage?: string | null;
    };

    const capsuleId = body.capsuleId?.trim();
    const postId = body.postId?.trim() || null;
    const durationMs = typeof body.durationMs === "number" ? Math.max(0, body.durationMs) : null;
    const status = body.status === "failed" ? "failed" : "completed";
    const errorMessage = status === "failed" ? (body.errorMessage || null) : null;

    if (!capsuleId) {
      return json({ error: "capsuleId is required" }, 400);
    }

    // Optional auth
    const userId = getAuthUserId(req);

    // Idempotency: allow client-specified runId; otherwise generate
    const runId = (body.runId && body.runId.trim()) || crypto.randomUUID();

    // Insert run row, handle duplicate runId gracefully
    try {
      await env.DB.prepare(
        `INSERT INTO runs (id, capsule_id, post_id, user_id, started_at, duration_ms, status, error_message)
         VALUES (?, ?, ?, ?, strftime('%s','now'), ?, ?, ?)`
      )
        .bind(runId, capsuleId, postId, userId, durationMs, status, errorMessage)
        .run();
    } catch (e: any) {
      if (e?.message?.includes("UNIQUE")) {
        // Duplicate runId: treat as idempotent success
        return json({ ok: true, runId, idempotent: true });
      }
      throw e;
    }

    // Best-effort counters
    if (userId) {
      incrementUserCounters(env, userId, { runsDelta: 1 }).catch((err) => {
        console.error("E-API-0008 completeRun user runs counter failed", {
          userId,
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    if (postId) {
      // No post denormalized counters yet; keep API for future
      incrementPostStats(env, postId, { runsDelta: 1 }).catch((err) => {
        console.error("E-API-0009 completeRun post runs counter failed", {
          postId,
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    if (userId) {
      (async () => {
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
            console.error("E-API-0016 completeRun run quota analytics write failed", {
              userId,
              runsThisMonth,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } catch (err) {
          console.error("E-API-0017 completeRun run quota snapshot failed", {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    }

    return json({ ok: true, runId });
  } catch (error) {
    return json({ error: "Failed to log run", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
};

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

export const appendRunLogs: Handler = async (req, env, _ctx, params) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const runId = params.p1;
  if (!runId) {
    return json({ error: "runId is required" }, 400);
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
    logs?: unknown;
  };

  const logs = sanitizeLogs(payload.logs);
  if (logs.length === 0) {
    return json({ error: "logs array required" }, 400);
  }

  const dataset = env.vibecodr_analytics_engine;
  if (dataset && typeof dataset.writeDataPoint === "function") {
    for (const entry of logs) {
      try {
        dataset.writeDataPoint({
          indexes: [runId],
          blobs: [
            "player_console_log",
            entry.level,
            entry.source,
            entry.message,
            payload.capsuleId || "",
            payload.postId || "",
          ],
          doubles: [entry.timestamp, entry.sampleRate],
        });
      } catch (err) {
        console.error("E-API-0015 appendRunLogs analytics write failed", {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return json({ ok: true, accepted: logs.length });
};
