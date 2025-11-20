import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { Env } from "./index";

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

// Helper functions for common queries
export async function getUserById(env: Env, id: string) {
  const db = getDb(env);
  return await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, id),
  });
}

export async function getUserByHandle(env: Env, handle: string) {
  const db = getDb(env);
  return await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.handle, handle),
  });
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
