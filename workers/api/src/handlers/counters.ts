import type { Env } from "../types";
import { hashToShard } from "../lib/sharding";

// Small, centralized counter helpers. No schema changes. Safe against negatives.
export const ERROR_USER_COUNTER_UPDATE_FAILED = "E-VIBECODR-0108";
export const ERROR_POST_STATS_UPDATE_FAILED = "E-VIBECODR-0109";

type CounterDoMode = "primary" | "shadow" | "off";

type CounterDoPayload =
  | {
      kind: "user";
      userId: string;
      deltas: {
        followersDelta?: number;
        followingDelta?: number;
        postsDelta?: number;
        runsDelta?: number;
        remixesDelta?: number;
      };
    }
  | {
      kind: "post";
      postId: string;
      deltas: { likesDelta?: number; commentsDelta?: number; runsDelta?: number; remixesDelta?: number };
    };

function getCounterMode(env: Env): CounterDoMode {
  const raw = String(env.COUNTER_DO_MODE ?? "primary").trim().toLowerCase();
  if (raw === "shadow") return "shadow";
  if (raw === "off" || raw === "legacy" || raw === "disabled") return "off";
  return "primary";
}

function getCounterStub(env: Env, shardKey: string): DurableObjectStub | null {
  if (!env.COUNTER_SHARD) return null;
  try {
    const shardName = hashToShard(shardKey);
    const id = env.COUNTER_SHARD.idFromName(shardName);
    return env.COUNTER_SHARD.get(id);
  } catch (err) {
    console.error("E-VIBECODR-2144 counter shard resolve failed", {
      shardKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function enqueueCounterUpdate(env: Env, payload: CounterDoPayload): Promise<{ delivered: boolean; mode: CounterDoMode }> {
  const mode = getCounterMode(env);
  if (!env.COUNTER_SHARD || mode === "off") {
    return { delivered: false, mode };
  }

  const shardKey = payload.kind === "user" ? payload.userId : payload.postId;
  const stub = getCounterStub(env, shardKey);
  if (!stub) {
    return { delivered: false, mode };
  }

  try {
    const res = await stub.fetch("https://do/counter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        payload.kind === "user"
          ? { op: "incrementUser", userId: payload.userId, shadow: mode === "shadow", ...payload.deltas }
          : { op: "incrementPost", postId: payload.postId, shadow: mode === "shadow", ...payload.deltas }
      ),
    });
    if (!res.ok) {
      console.error("E-VIBECODR-2145 counter DO enqueue rejected", {
        shardKey,
        status: res.status,
      });
      return { delivered: false, mode };
    }
    return { delivered: true, mode };
  } catch (err) {
    console.error("E-VIBECODR-2145 counter DO enqueue failed", {
      shardKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return { delivered: false, mode };
  }
}

type CounterUpdateMeta = {
  code: string;
  op: string;
  details?: Record<string, unknown>;
};

/**
 * Run a counter update reliably.
 * - If a request context is available, use waitUntil so work isn't dropped after the response.
 * - Without a context (tests or background tasks), await the update to avoid silent loss.
 */
export async function runCounterUpdate(
  ctx: Pick<ExecutionContext, "waitUntil"> | null,
  update: () => Promise<void>,
  meta: CounterUpdateMeta
): Promise<void> {
  let task: Promise<void>;
  try {
    task = update();
  } catch (err) {
    console.error(`${meta.code} ${meta.op} failed`, {
      ...(meta.details ?? {}),
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const wrapped = task.catch((err) => {
    console.error(`${meta.code} ${meta.op} failed`, {
      ...(meta.details ?? {}),
      error: err instanceof Error ? err.message : String(err),
    });
  });

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(wrapped);
    return;
  }

  await wrapped;
}

function clampDelta(currentExpr: string, deltaParam: string) {
  // SQLite doesn't have GREATEST; MAX avoids double-binding while preventing negatives
  return `MAX(${currentExpr} + ${deltaParam}, 0)`;
}

export async function incrementUserCounters(
  env: Env,
  userId: string,
  deltas: {
    followersDelta?: number;
    followingDelta?: number;
    postsDelta?: number;
    runsDelta?: number;
    remixesDelta?: number;
  }
): Promise<void> {
  const normalized = {
    ...(typeof deltas.followersDelta === "number" && deltas.followersDelta !== 0
      ? { followersDelta: deltas.followersDelta }
      : {}),
    ...(typeof deltas.followingDelta === "number" && deltas.followingDelta !== 0
      ? { followingDelta: deltas.followingDelta }
      : {}),
    ...(typeof deltas.postsDelta === "number" && deltas.postsDelta !== 0 ? { postsDelta: deltas.postsDelta } : {}),
    ...(typeof deltas.runsDelta === "number" && deltas.runsDelta !== 0 ? { runsDelta: deltas.runsDelta } : {}),
    ...(typeof deltas.remixesDelta === "number" && deltas.remixesDelta !== 0
      ? { remixesDelta: deltas.remixesDelta }
      : {}),
  };

  if (Object.keys(normalized).length === 0) return; // nothing to do

  const dispatch = await enqueueCounterUpdate(env, { kind: "user", userId, deltas: normalized });
  const shouldFallback = dispatch.mode === "shadow" || !dispatch.delivered;
  if (!shouldFallback) {
    return;
  }

  const updates: string[] = [];
  const binds: any[] = [];

  if (typeof normalized.followersDelta === "number") {
    updates.push(`followers_count = ${clampDelta("followers_count", "?")}`);
    binds.push(normalized.followersDelta);
  }
  if (typeof normalized.followingDelta === "number") {
    updates.push(`following_count = ${clampDelta("following_count", "?")}`);
    binds.push(normalized.followingDelta);
  }
  if (typeof normalized.postsDelta === "number") {
    updates.push(`posts_count = ${clampDelta("posts_count", "?")}`);
    binds.push(normalized.postsDelta);
  }
  if (typeof normalized.runsDelta === "number") {
    updates.push(`runs_count = ${clampDelta("runs_count", "?")}`);
    binds.push(normalized.runsDelta);
  }
  if (typeof normalized.remixesDelta === "number") {
    updates.push(`remixes_count = ${clampDelta("remixes_count", "?")}`);
    binds.push(normalized.remixesDelta);
  }

  await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...binds, userId)
    .run();
}

// Placeholder for future post metrics denormalization. Currently stats are derived in queries.
export async function incrementPostStats(
  env: Env,
  postId: string,
  deltas: { likesDelta?: number; commentsDelta?: number; runsDelta?: number; remixesDelta?: number }
): Promise<void> {
  const normalized = {
    ...(typeof deltas.likesDelta === "number" && deltas.likesDelta !== 0 ? { likesDelta: deltas.likesDelta } : {}),
    ...(typeof deltas.commentsDelta === "number" && deltas.commentsDelta !== 0
      ? { commentsDelta: deltas.commentsDelta }
      : {}),
    ...(typeof deltas.runsDelta === "number" && deltas.runsDelta !== 0 ? { runsDelta: deltas.runsDelta } : {}),
    ...(typeof deltas.remixesDelta === "number" && deltas.remixesDelta !== 0
      ? { remixesDelta: deltas.remixesDelta }
      : {}),
  };

  if (Object.keys(normalized).length === 0) return;

  const dispatch = await enqueueCounterUpdate(env, { kind: "post", postId, deltas: normalized });
  const shouldFallback = dispatch.mode === "shadow" || !dispatch.delivered;
  if (!shouldFallback) {
    return;
  }

  const updates: string[] = [];
  const binds: any[] = [];

  if (typeof normalized.likesDelta === "number") {
    updates.push(`likes_count = ${clampDelta("likes_count", "?")}`);
    binds.push(normalized.likesDelta);
  }
  if (typeof normalized.commentsDelta === "number") {
    updates.push(`comments_count = ${clampDelta("comments_count", "?")}`);
    binds.push(normalized.commentsDelta);
  }
  if (typeof normalized.runsDelta === "number") {
    updates.push(`runs_count = ${clampDelta("runs_count", "?")}`);
    binds.push(normalized.runsDelta);
  }
  if (typeof normalized.remixesDelta === "number") {
    updates.push(`remixes_count = ${clampDelta("remixes_count", "?")}`);
    binds.push(normalized.remixesDelta);
  }

  await env.DB.prepare(`UPDATE posts SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...binds, postId)
    .run();
}
