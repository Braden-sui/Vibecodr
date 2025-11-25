import { requireAdmin } from "../auth";
import { json } from "../lib/responses";
import type { Handler } from "../types";
import { PlanSchema } from "@vibecodr/shared";
import { z } from "zod";

const updateUserPlanSchema = z
  .object({
    userId: z.string().trim().min(1).optional(),
    handle: z.string().trim().min(1).optional(),
    plan: PlanSchema,
  })
  .refine((value) => !!value.userId || !!value.handle, {
    message: "userId or handle is required",
  });

export const updateUserPlan: Handler = requireAdmin(async (req, env, _ctx, _params, admin) => {
  if (req.method !== "POST" && req.method !== "PATCH") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = updateUserPlanSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const { userId, handle, plan } = parsed.data;

  const target = await env.DB.prepare(
    handle
      ? "SELECT id, handle, plan FROM users WHERE LOWER(handle) = LOWER(?) LIMIT 1"
      : "SELECT id, handle, plan FROM users WHERE id = ? LIMIT 1"
  )
    .bind(handle ?? userId)
    .first<{ id: string; handle: string; plan: string } | undefined>();

  if (!target) {
    return json({ error: "User not found" }, 404);
  }

  await env.DB.prepare("UPDATE users SET plan = ? WHERE id = ?").bind(plan, target.id).run();

  return json({
    ok: true,
    userId: target.id,
    handle: target.handle,
    planBefore: target.plan,
    planAfter: plan,
    changedBy: admin.userId,
  });
});

const searchUsersSchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchUsers: Handler = requireAdmin(async (req, env) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const parsed = searchUsersSchema.safeParse({
    q: url.searchParams.get("q") || "",
    limit: url.searchParams.get("limit") || "20",
  });

  if (!parsed.success) {
    return json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const { q, limit } = parsed.data;
  const term = `%${q.toLowerCase()}%`;

  const { results } = await env.DB.prepare(
    `
    SELECT id, handle, name, bio, plan, email, created_at
    FROM users
    WHERE LOWER(handle) LIKE ? OR LOWER(name) LIKE ? OR LOWER(email) LIKE ?
    ORDER BY created_at DESC
    LIMIT ?
    `
  )
    .bind(term, term, term, limit)
    .all();

  return json({
    ok: true,
    users: (results || []).map((row: any) => ({
      id: String(row.id),
      handle: String(row.handle),
      name: row.name ?? null,
      bio: row.bio ?? null,
      plan: row.plan ?? "free",
      email: row.email ?? null,
      createdAt: row.created_at,
    })),
  });
});
