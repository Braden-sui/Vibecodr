import type { Env } from "../types";

type NumericRecord = Record<string, number>;

type PostCounterDrift = {
  id: string;
  likes?: number;
  comments?: number;
  runs?: number;
};

type UserCounterDrift = {
  id: string;
  followers?: number;
  following?: number;
  posts?: number;
  runs?: number;
  remixes?: number;
};

function toInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function mapFromResults(results: any[], key: string, value: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of results || []) {
    const k = row?.[key];
    if (typeof k !== "string") continue;
    m.set(k, toInt(row?.[value]));
  }
  return m;
}

export function computePostDrift(
  rows: Array<{ id: string; likes_count?: number; comments_count?: number; runs_count?: number }>,
  likes: Map<string, number>,
  comments: Map<string, number>,
  runs: Map<string, number>
): PostCounterDrift[] {
  const drift: PostCounterDrift[] = [];
  for (const row of rows) {
    const expectedLikes = likes.get(row.id) ?? 0;
    const expectedComments = comments.get(row.id) ?? 0;
    const expectedRuns = runs.get(row.id) ?? 0;

    const updates: PostCounterDrift = { id: row.id };
    if (expectedLikes !== toInt(row.likes_count)) updates.likes = expectedLikes;
    if (expectedComments !== toInt(row.comments_count)) updates.comments = expectedComments;
    if (expectedRuns !== toInt(row.runs_count)) updates.runs = expectedRuns;

    if (updates.likes !== undefined || updates.comments !== undefined || updates.runs !== undefined) {
      drift.push(updates);
    }
  }
  return drift;
}

export function computeUserDrift(
  rows: Array<{
    id: string;
    followers_count?: number;
    following_count?: number;
    posts_count?: number;
    runs_count?: number;
    remixes_count?: number;
  }>,
  followers: Map<string, number>,
  following: Map<string, number>,
  posts: Map<string, number>,
  runs: Map<string, number>,
  remixes: Map<string, number>
): UserCounterDrift[] {
  const drift: UserCounterDrift[] = [];
  for (const row of rows) {
    const updates: UserCounterDrift = { id: row.id };
    if ((followers.get(row.id) ?? 0) !== toInt(row.followers_count)) {
      updates.followers = followers.get(row.id) ?? 0;
    }
    if ((following.get(row.id) ?? 0) !== toInt(row.following_count)) {
      updates.following = following.get(row.id) ?? 0;
    }
    if ((posts.get(row.id) ?? 0) !== toInt(row.posts_count)) {
      updates.posts = posts.get(row.id) ?? 0;
    }
    if ((runs.get(row.id) ?? 0) !== toInt(row.runs_count)) {
      updates.runs = runs.get(row.id) ?? 0;
    }
    if ((remixes.get(row.id) ?? 0) !== toInt(row.remixes_count)) {
      updates.remixes = remixes.get(row.id) ?? 0;
    }
    if (
      updates.followers !== undefined ||
      updates.following !== undefined ||
      updates.posts !== undefined ||
      updates.runs !== undefined ||
      updates.remixes !== undefined
    ) {
      drift.push(updates);
    }
  }
  return drift;
}

async function fetchPostAggregates(env: Env): Promise<{
  likes: Map<string, number>;
  comments: Map<string, number>;
  runs: Map<string, number>;
}> {
  const likesRes = await env.DB.prepare(
    "SELECT post_id, COUNT(*) as count FROM likes GROUP BY post_id"
  ).all();

  const commentsRes = await env.DB.prepare(
    "SELECT post_id, COUNT(*) as count FROM comments WHERE quarantined IS NULL OR quarantined = 0 GROUP BY post_id"
  ).all();

  const runsRes = await env.DB.prepare(
    "SELECT post_id, COUNT(*) as count FROM runs WHERE post_id IS NOT NULL AND status IS NOT NULL GROUP BY post_id"
  ).all();

  return {
    likes: mapFromResults(likesRes?.results ?? [], "post_id", "count"),
    comments: mapFromResults(commentsRes?.results ?? [], "post_id", "count"),
    runs: mapFromResults(runsRes?.results ?? [], "post_id", "count"),
  };
}

async function fetchUserAggregates(env: Env): Promise<{
  followers: Map<string, number>;
  following: Map<string, number>;
  posts: Map<string, number>;
  runs: Map<string, number>;
  remixes: Map<string, number>;
}> {
  const followersRes = await env.DB.prepare(
    "SELECT followee_id as user_id, COUNT(*) as count FROM follows GROUP BY followee_id"
  ).all();

  const followingRes = await env.DB.prepare(
    "SELECT follower_id as user_id, COUNT(*) as count FROM follows GROUP BY follower_id"
  ).all();

  const postsRes = await env.DB.prepare(
    "SELECT author_id as user_id, COUNT(*) as count FROM posts GROUP BY author_id"
  ).all();

  const runsRes = await env.DB.prepare(
    "SELECT user_id, COUNT(*) as count FROM runs WHERE user_id IS NOT NULL GROUP BY user_id"
  ).all();

  const remixesRes = await env.DB.prepare(
    "SELECT c.owner_id as user_id, COUNT(*) as count FROM remixes r JOIN capsules c ON r.child_capsule_id = c.id GROUP BY c.owner_id"
  ).all();

  return {
    followers: mapFromResults(followersRes?.results ?? [], "user_id", "count"),
    following: mapFromResults(followingRes?.results ?? [], "user_id", "count"),
    posts: mapFromResults(postsRes?.results ?? [], "user_id", "count"),
    runs: mapFromResults(runsRes?.results ?? [], "user_id", "count"),
    remixes: mapFromResults(remixesRes?.results ?? [], "user_id", "count"),
  };
}

async function reconcilePosts(env: Env): Promise<number> {
  const postsRes = await env.DB.prepare(
    "SELECT id, likes_count, comments_count, runs_count FROM posts"
  ).all();
  const aggregates = await fetchPostAggregates(env);
  const rows =
    (postsRes?.results as Array<{ id: string; likes_count?: number; comments_count?: number; runs_count?: number }>) ??
    [];

  let updated = 0;
  for (const row of rows) {
    const expectedLikes = aggregates.likes.get(row.id) ?? 0;
    const expectedComments = aggregates.comments.get(row.id) ?? 0;
    const expectedRuns = aggregates.runs.get(row.id) ?? 0;
    const currentLikes = toInt(row.likes_count);
    const currentComments = toInt(row.comments_count);
    const currentRuns = toInt(row.runs_count);

    const sets: string[] = [];
    const binds: Array<string | number> = [];
    const wheres: string[] = [];
    const whereBinds: Array<string | number> = [];

    if (expectedLikes !== currentLikes) {
      sets.push("likes_count = ?");
      binds.push(expectedLikes);
      wheres.push("likes_count = ?");
      whereBinds.push(currentLikes);
    }
    if (expectedComments !== currentComments) {
      sets.push("comments_count = ?");
      binds.push(expectedComments);
      wheres.push("comments_count = ?");
      whereBinds.push(currentComments);
    }
    if (expectedRuns !== currentRuns) {
      sets.push("runs_count = ?");
      binds.push(expectedRuns);
      wheres.push("runs_count = ?");
      whereBinds.push(currentRuns);
    }
    if (sets.length === 0) continue;
    try {
      const whereClause = wheres.length > 0 ? ` AND ${wheres.join(" AND ")}` : "";
      await env.DB.prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = ?${whereClause}`)
        .bind(...binds, row.id, ...whereBinds)
        .run();
      updated += 1;
    } catch (err) {
      console.error("E-VIBECODR-RECON-POST update failed", {
        postId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return updated;
}

async function reconcileUsers(env: Env): Promise<number> {
  const usersRes = await env.DB.prepare(
    "SELECT id, followers_count, following_count, posts_count, runs_count, remixes_count FROM users"
  ).all();
  const aggregates = await fetchUserAggregates(env);
  const rows =
    (usersRes?.results as Array<{
      id: string;
      followers_count?: number;
      following_count?: number;
      posts_count?: number;
      runs_count?: number;
      remixes_count?: number;
    }>) ?? [];

  let updated = 0;
  for (const row of rows) {
    const expectedFollowers = aggregates.followers.get(row.id) ?? 0;
    const expectedFollowing = aggregates.following.get(row.id) ?? 0;
    const expectedPosts = aggregates.posts.get(row.id) ?? 0;
    const expectedRuns = aggregates.runs.get(row.id) ?? 0;
    const expectedRemixes = aggregates.remixes.get(row.id) ?? 0;

    const currentFollowers = toInt(row.followers_count);
    const currentFollowing = toInt(row.following_count);
    const currentPosts = toInt(row.posts_count);
    const currentRuns = toInt(row.runs_count);
    const currentRemixes = toInt(row.remixes_count);

    const sets: string[] = [];
    const binds: Array<string | number> = [];
    const wheres: string[] = [];
    const whereBinds: Array<string | number> = [];

    if (expectedFollowers !== currentFollowers) {
      sets.push("followers_count = ?");
      binds.push(expectedFollowers);
      wheres.push("followers_count = ?");
      whereBinds.push(currentFollowers);
    }
    if (expectedFollowing !== currentFollowing) {
      sets.push("following_count = ?");
      binds.push(expectedFollowing);
      wheres.push("following_count = ?");
      whereBinds.push(currentFollowing);
    }
    if (expectedPosts !== currentPosts) {
      sets.push("posts_count = ?");
      binds.push(expectedPosts);
      wheres.push("posts_count = ?");
      whereBinds.push(currentPosts);
    }
    if (expectedRuns !== currentRuns) {
      sets.push("runs_count = ?");
      binds.push(expectedRuns);
      wheres.push("runs_count = ?");
      whereBinds.push(currentRuns);
    }
    if (expectedRemixes !== currentRemixes) {
      sets.push("remixes_count = ?");
      binds.push(expectedRemixes);
      wheres.push("remixes_count = ?");
      whereBinds.push(currentRemixes);
    }
    if (sets.length === 0) continue;
    try {
      const whereClause = wheres.length > 0 ? ` AND ${wheres.join(" AND ")}` : "";
      await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?${whereClause}`)
        .bind(...binds, row.id, ...whereBinds)
        .run();
      updated += 1;
    } catch (err) {
      console.error("E-VIBECODR-RECON-USER update failed", {
        userId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return updated;
}

export async function reconcileCounters(env: Env): Promise<void> {
  const [postsUpdated, usersUpdated] = await Promise.all([reconcilePosts(env), reconcileUsers(env)]);
  console.info("E-VIBECODR-RECON counters reconciled", {
    postsUpdated,
    usersUpdated,
  });
}
