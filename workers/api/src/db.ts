// Minimal DB helper skeleton for D1 access. Replace with Drizzle/Kysely later.

export type Env = { DB: D1Database };

export async function getPostById(env: Env, id: string) {
  const { results } = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).all();
  return results?.[0] || null;
}

export async function upsertUser(env: Env, user: { id: string; handle: string; name?: string; avatar_url?: string }) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO users (id, handle, name, avatar_url) VALUES (?, ?, ?, ?)"
  ).bind(user.id, user.handle, user.name || null, user.avatar_url || null).run();
}

