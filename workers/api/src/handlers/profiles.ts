// Profile and user-related handlers
// References: research-social-platforms.md (Profiles section)

import type { Handler } from "../index";

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init
  });
}

/**
 * GET /users/:handle
 * Get user profile by handle with stats
 */
export const getUserProfile: Handler = async (req, env, ctx, params) => {
  const handle = params.p1;

  try {
    // Get user basic info
    const user = await env.DB.prepare(
      "SELECT id, handle, name, avatar_url, bio, plan, created_at FROM users WHERE handle = ?"
    ).bind(handle).first();

    if (!user) {
      return json({ error: "User not found" }, 404);
    }

    // Get stats in parallel
    const [
      followerCount,
      followingCount,
      postCount,
      runCount,
      remixCount,
    ] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as count FROM follows WHERE followee_id = ?")
        .bind(user.id).first(),
      env.DB.prepare("SELECT COUNT(*) as count FROM follows WHERE follower_id = ?")
        .bind(user.id).first(),
      env.DB.prepare("SELECT COUNT(*) as count FROM posts WHERE author_id = ?")
        .bind(user.id).first(),
      env.DB.prepare(`
        SELECT COUNT(*) as count FROM runs r
        INNER JOIN capsules c ON r.capsule_id = c.id
        WHERE c.owner_id = ?
      `).bind(user.id).first(),
      env.DB.prepare(`
        SELECT COUNT(*) as count FROM remixes rem
        INNER JOIN capsules c ON rem.child_capsule_id = c.id
        WHERE c.owner_id = ?
      `).bind(user.id).first(),
    ]);

    return json({
      user: {
        id: user.id,
        handle: user.handle,
        name: user.name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        plan: user.plan,
        createdAt: user.created_at,
        stats: {
          followers: followerCount?.count || 0,
          following: followingCount?.count || 0,
          posts: postCount?.count || 0,
          runs: runCount?.count || 0,
          remixes: remixCount?.count || 0,
        },
      },
    });
  } catch (error) {
    return json({
      error: "Failed to fetch user profile",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
};

/**
 * GET /users/:handle/posts?limit=20&offset=0
 * Get posts by user
 */
export const getUserPosts: Handler = async (req, env, ctx, params) => {
  const handle = params.p1;
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  try {
    // Get user ID from handle
    const user = await env.DB.prepare(
      "SELECT id FROM users WHERE handle = ?"
    ).bind(handle).first();

    if (!user) {
      return json({ error: "User not found" }, 404);
    }

    // Get posts with capsule info
    const { results } = await env.DB.prepare(`
      SELECT
        p.id, p.type, p.title, p.description, p.tags, p.created_at,
        c.id as capsule_id, c.manifest_json
      FROM posts p
      LEFT JOIN capsules c ON p.capsule_id = c.id
      WHERE p.author_id = ?
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(user.id, limit, offset).all();

    // Get stats for each post
    const posts = await Promise.all((results || []).map(async (row: any) => {
      const [likeCount, commentCount, remixCount] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) as count FROM likes WHERE post_id = ?")
          .bind(row.id).first(),
        env.DB.prepare("SELECT COUNT(*) as count FROM comments WHERE post_id = ?")
          .bind(row.id).first(),
        row.capsule_id ? env.DB.prepare(`
          SELECT COUNT(*) as count FROM remixes WHERE parent_capsule_id = ?
        `).bind(row.capsule_id).first() : Promise.resolve({ count: 0 }),
      ]);

      return {
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        tags: row.tags ? JSON.parse(row.tags) : [],
        capsule: row.capsule_id ? {
          id: row.capsule_id,
          ...JSON.parse(row.manifest_json),
        } : null,
        createdAt: row.created_at,
        stats: {
          likes: likeCount?.count || 0,
          comments: commentCount?.count || 0,
          remixes: remixCount?.count || 0,
          runs: 0, // TODO: Get from runs table
        },
      };
    }));

    return json({ posts, limit, offset });
  } catch (error) {
    return json({
      error: "Failed to fetch user posts",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
};

/**
 * GET /users/:userId/check-following?targetId=...
 * Check if current user follows target user
 * Requires auth
 */
export const checkFollowing: Handler = async (req, env, ctx, params) => {
  const url = new URL(req.url);
  const targetId = url.searchParams.get("targetId");

  // TODO: Get current user from auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ following: false });
  }
  const userId = authHeader.replace("Bearer ", "");

  if (!targetId) {
    return json({ error: "targetId required" }, 400);
  }

  try {
    const result = await env.DB.prepare(
      "SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?"
    ).bind(userId, targetId).first();

    return json({ following: !!result });
  } catch (error) {
    return json({
      error: "Failed to check following status",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
};

/**
 * GET /posts/:postId/check-liked
 * Check if current user has liked a post
 * Requires auth
 */
export const checkLiked: Handler = async (req, env, ctx, params) => {
  const postId = params.p1;

  // TODO: Get current user from auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ liked: false });
  }
  const userId = authHeader.replace("Bearer ", "");

  try {
    const result = await env.DB.prepare(
      "SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?"
    ).bind(userId, postId).first();

    return json({ liked: !!result });
  } catch (error) {
    return json({
      error: "Failed to check like status",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
};
