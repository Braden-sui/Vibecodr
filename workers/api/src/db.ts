// Minimal DB helper skeleton for D1 access. Replace with Drizzle/Kysely later.

export type Env = { DB: D1Database };

export async function getPostById(env: Env, id: string) {
  const { results } = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).all();
  return results?.[0] || null;
}

export async function upsertUser(env: Env, user: { id: string; email?: string; password_hash?: string }) {
  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email=excluded.email, password_hash=COALESCE(excluded.password_hash, users.password_hash)`
  ).bind(user.id, user.email || null, user.password_hash || null).run();
}

export async function upsertProfile(
  env: Env,
  profile: {
    id: string;
    user_id: string;
    handle: string;
    display_name?: string;
    avatar_url?: string;
    bio?: string;
    theme?: string;
  }
) {
  await env.DB.prepare(
    `INSERT INTO profiles (id, user_id, handle, display_name, avatar_url, bio, theme)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       handle=excluded.handle,
       display_name=excluded.display_name,
       avatar_url=excluded.avatar_url,
       bio=excluded.bio,
       theme=excluded.theme`
  )
    .bind(
      profile.id,
      profile.user_id,
      profile.handle,
      profile.display_name || null,
      profile.avatar_url || null,
      profile.bio || null,
      profile.theme || null
    )
    .run();
}
