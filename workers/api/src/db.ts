import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { PlanSchema, type Plan } from "@vibecodr/shared";
import type { Env } from "./types";

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

export async function upsertUser(
  env: Env,
  user: {
    id: string;
    handle: string;
    name?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    plan?: Plan | null;
  }
) {
  const parsedPlan = user.plan == null ? null : PlanSchema.safeParse(user.plan);
  const plan = parsedPlan?.success ? parsedPlan.data : null;

  await env.DB.prepare(
    `INSERT INTO users (id, handle, name, avatar_url, bio, plan)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       handle=excluded.handle,
       name=COALESCE(excluded.name, users.name),
       avatar_url=COALESCE(excluded.avatar_url, users.avatar_url),
       bio=COALESCE(excluded.bio, users.bio),
       plan=COALESCE(excluded.plan, users.plan)`
  )
    .bind(
      user.id,
      user.handle,
      user.name ?? null,
      user.avatarUrl ?? null,
      user.bio ?? null,
      plan
    )
    .run();
}

export async function upsertProfile(
  env: Env,
  profile: {
    userId: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    tagline?: string | null;
    location?: string | null;
    websiteUrl?: string | null;
    xHandle?: string | null;
    githubHandle?: string | null;
    pronouns?: string | null;
    searchTags?: string | null;
    aboutMd?: string | null;
    layoutVersion?: number | null;
  }
) {
  await env.DB.prepare(
    `INSERT INTO profiles (user_id, display_name, avatar_url, bio, tagline, location, website_url, x_handle, github_handle, pronouns, search_tags, about_md, layout_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 1), strftime('%s','now'))
     ON CONFLICT(user_id) DO UPDATE SET
       display_name=excluded.display_name,
       avatar_url=excluded.avatar_url,
       bio=excluded.bio,
       tagline=excluded.tagline,
       location=excluded.location,
       website_url=excluded.website_url,
       x_handle=excluded.x_handle,
       github_handle=excluded.github_handle,
       pronouns=excluded.pronouns,
       search_tags=excluded.search_tags,
       about_md=excluded.about_md,
       layout_version=excluded.layout_version,
       updated_at=excluded.updated_at`
  )
    .bind(
      profile.userId,
      profile.displayName ?? null,
      profile.avatarUrl ?? null,
      profile.bio ?? null,
      profile.tagline ?? null,
      profile.location ?? null,
      profile.websiteUrl ?? null,
      profile.xHandle ?? null,
      profile.githubHandle ?? null,
      profile.pronouns ?? null,
      profile.searchTags ?? null,
      profile.aboutMd ?? null,
      profile.layoutVersion ?? null
    )
    .run();
}
