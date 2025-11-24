import type { Handler } from "../types";
import { updateUserSchema } from "../schema";
import { requireUser } from "../auth";
import { json } from "../lib/responses";

// POST /users/sync
// Upsert user from Clerk payload. users.id == Clerk user.id
export const syncUser: Handler = requireUser(async (req, env, _ctx, _params, authedUserId) => {
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
  if (id !== authedUserId) {
    return json({ error: "E-VIBECODR-0404 sync mismatch" }, 403);
  }

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
});
