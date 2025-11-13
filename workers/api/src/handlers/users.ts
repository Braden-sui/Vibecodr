import type { Handler } from "../index";
import { createUserSchema, updateUserSchema } from "../schema";

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

// POST /users/sync
// Upsert user from Clerk payload. users.id == Clerk user.id
export const syncUser: Handler = async (req, env) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Accept both create and update shapes; require id
  const base = updateUserSchema.safeParse(body);
  if (!base.success) {
    return json({ error: "Validation failed", details: base.error.flatten() }, 400);
  }
  const { id, handle, name, avatarUrl, bio, plan } = base.data;

  try {
    // Try update first
    const res = await env.DB.prepare(
      `UPDATE users SET
        handle = COALESCE(?, handle),
        name = COALESCE(?, name),
        avatar_url = COALESCE(?, avatar_url),
        bio = COALESCE(?, bio),
        plan = COALESCE(?, plan)
      WHERE id = ?`
    ).bind(handle ?? null, name ?? null, avatarUrl ?? null, bio ?? null, plan ?? null, id).run();

    if (res.meta.changes && res.meta.changes > 0) {
      return json({ ok: true, updated: true, id });
    }

    // Insert if not exists with counters default 0
    await env.DB.prepare(
      `INSERT INTO users (id, handle, name, avatar_url, bio, plan)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, 'free'))`
    ).bind(id, handle, name ?? null, avatarUrl ?? null, bio ?? null, plan ?? null).run();

    return json({ ok: true, created: true, id });
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint failed: users.handle")) {
      return json({ error: "Handle already taken" }, 409);
    }
    return json({ error: "Failed to sync user", details: e?.message || "unknown" }, 500);
  }
};
