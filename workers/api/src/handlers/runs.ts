import type { Env } from "../index";
import { incrementPostStats, incrementUserCounters } from "./counters";

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

    return json({ ok: true, runId });
  } catch (error) {
    return json({ error: "Failed to log run", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
};
