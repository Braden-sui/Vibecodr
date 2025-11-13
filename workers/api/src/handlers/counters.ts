import type { Env } from "../index";

// Small, centralized counter helpers. No schema changes. Safe against negatives.

function clampDelta(currentExpr: string, deltaParam: string) {
  // SQLite doesn't have GREATEST; use CASE to prevent negatives
  return `CASE WHEN ${currentExpr} + ${deltaParam} < 0 THEN 0 ELSE ${currentExpr} + ${deltaParam} END`;
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
  const updates: string[] = [];
  const binds: any[] = [];

  if (typeof deltas.followersDelta === "number" && deltas.followersDelta !== 0) {
    updates.push(`followers_count = ${clampDelta("followers_count", "?")}`);
    binds.push(deltas.followersDelta);
  }
  if (typeof deltas.followingDelta === "number" && deltas.followingDelta !== 0) {
    updates.push(`following_count = ${clampDelta("following_count", "?")}`);
    binds.push(deltas.followingDelta);
  }
  if (typeof deltas.postsDelta === "number" && deltas.postsDelta !== 0) {
    updates.push(`posts_count = ${clampDelta("posts_count", "?")}`);
    binds.push(deltas.postsDelta);
  }
  if (typeof deltas.runsDelta === "number" && deltas.runsDelta !== 0) {
    updates.push(`runs_count = ${clampDelta("runs_count", "?")}`);
    binds.push(deltas.runsDelta);
  }
  if (typeof deltas.remixesDelta === "number" && deltas.remixesDelta !== 0) {
    updates.push(`remixes_count = ${clampDelta("remixes_count", "?")}`);
    binds.push(deltas.remixesDelta);
  }

  if (updates.length === 0) return; // nothing to do

  try {
    await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...binds, userId)
      .run();
  } catch (err) {
    console.error("E-API-0001 incrementUserCounters failed", {
      userId,
      deltas,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Placeholder for future post metrics denormalization. Currently stats are derived in queries.
export async function incrementPostStats(
  _env: Env,
  _postId: string,
  _deltas: { likesDelta?: number; commentsDelta?: number; runsDelta?: number; remixesDelta?: number }
): Promise<void> {
  // No-op: posts table has no denormalized counters. Kept for future use.
  return;
}
