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

export async function getPostById(env: Env, id: string) {
  const db = getDb(env);
  return await db.query.posts.findFirst({
    where: (posts, { eq }) => eq(posts.id, id),
    with: {
      author: true,
      capsule: true,
    },
  });
}

export async function getCapsuleById(env: Env, id: string) {
  const db = getDb(env);
  return await db.query.capsules.findFirst({
    where: (capsules, { eq }) => eq(capsules.id, id),
    with: {
      owner: true,
    },
  });
}
