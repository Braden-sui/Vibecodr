import type { Env } from "./index";

type RateLimitRow = { count?: number; reset_at?: number };
type RateLimitResult = { allowed: boolean; remaining?: number; resetAt?: number };

const TABLE_NAME = "public_rate_limits";
const WINDOW_SEC_DEFAULT = 60;

async function ensureTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    )`
  ).run();
}

export async function checkPublicRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSec = WINDOW_SEC_DEFAULT
): Promise<RateLimitResult> {
  if (limit <= 0) {
    return { allowed: false, remaining: 0, resetAt: Date.now() + windowSec * 1000 };
  }

  const nowSec = Math.floor(Date.now() / 1000);

  try {
    await ensureTable(env);

    const row = await env.DB.prepare(`SELECT count, reset_at FROM ${TABLE_NAME} WHERE key = ? LIMIT 1`)
      .bind(key)
      .first<RateLimitRow>();

    if (!row || typeof row.reset_at !== "number" || nowSec >= row.reset_at) {
      const nextReset = nowSec + windowSec;
      await env.DB.prepare(
        `INSERT INTO ${TABLE_NAME} (key, count, reset_at)
         VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at`
      )
        .bind(key, nextReset)
        .run();

      return { allowed: true, remaining: Math.max(0, limit - 1), resetAt: nextReset * 1000 };
    }

    const currentCount = typeof row.count === "number" ? row.count : 0;
    if (currentCount >= limit) {
      return { allowed: false, remaining: 0, resetAt: row.reset_at * 1000 };
    }

    const nextCount = currentCount + 1;
    await env.DB.prepare(`UPDATE ${TABLE_NAME} SET count = ? WHERE key = ?`).bind(nextCount, key).run();
    return { allowed: true, remaining: Math.max(0, limit - nextCount), resetAt: row.reset_at * 1000 };
  } catch (err) {
    console.error("E-VIBECODR-0310 public rate limit check failed", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true };
  }
}

export function getClientIp(req: Request): string | null {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim()) return cfIp.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || null;
  }

  return null;
}
