// Profile and user-related handlers
// References: research-social-platforms.md (Profiles section)

import type { Handler, Env } from "../index";
import { requireUser, verifyAuth, isModeratorOrAdmin } from "../auth";
import { ApiUserProfileResponseSchema, ApiUserPostsResponseSchema } from "../contracts";
import { buildCapsuleSummary } from "../capsule-manifest";

type Params = Record<string, string>;

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

    const payload = {
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
    };

    const parsed = ApiUserProfileResponseSchema.parse(payload);
    return json(parsed);
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
    const authedUser = await verifyAuth(req, env);
    const isMod = !!(authedUser && isModeratorOrAdmin(authedUser));

    let query = `
      SELECT
        p.id, p.type, p.title, p.description, p.tags, p.cover_key, p.created_at,
        c.id as capsule_id, c.manifest_json
      FROM posts p
      LEFT JOIN capsules c ON p.capsule_id = c.id
      WHERE p.author_id = ?`;

    if (!isMod) {
      query += " AND (p.quarantined IS NULL OR p.quarantined = 0)";
    }

    query += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?";

    const { results } = await env.DB.prepare(query).bind(user.id, limit, offset).all();

    const rows = results || [];
    const postIds = rows.map((row: any) => row.id);
    const capsuleIds = Array.from(
      new Set(
        rows
          .map((row: any) => row.capsule_id)
          .filter((id: string | null | undefined) => !!id)
      )
    ) as string[];

    const likesByPost = new Map<string, number>();
    const commentsByPost = new Map<string, number>();
    const runsByCapsule = new Map<string, number>();
    const remixesByCapsule = new Map<string, number>();

    if (postIds.length > 0) {
      const placeholders = postIds.map(() => "?").join(",");

      const likesQuery = `
        SELECT post_id, COUNT(*) as count
        FROM likes
        WHERE post_id IN (${placeholders})
        GROUP BY post_id
      `;

      const commentsBase = `
        SELECT post_id, COUNT(*) as count
        FROM comments
        WHERE post_id IN (${placeholders})
      `;

      const commentsQuery = isMod
        ? `${commentsBase}
           GROUP BY post_id`
        : `${commentsBase}
           AND (quarantined IS NULL OR quarantined = 0)
           GROUP BY post_id`;

      const [likesResult, commentsResult] = await Promise.all([
        env.DB.prepare(likesQuery).bind(...postIds).all(),
        env.DB.prepare(commentsQuery).bind(...postIds).all(),
      ]);

      for (const row of likesResult.results || []) {
        likesByPost.set((row as any).post_id, Number((row as any).count ?? 0));
      }
      for (const row of commentsResult.results || []) {
        commentsByPost.set((row as any).post_id, Number((row as any).count ?? 0));
      }
    }

    if (capsuleIds.length > 0) {
      const placeholders = capsuleIds.map(() => "?").join(",");

      const runsQuery = `
        SELECT capsule_id, COUNT(*) as count
        FROM runs
        WHERE capsule_id IN (${placeholders})
        GROUP BY capsule_id
      `;

      const remixesQuery = `
        SELECT parent_capsule_id, COUNT(*) as count
        FROM remixes
        WHERE parent_capsule_id IN (${placeholders})
        GROUP BY parent_capsule_id
      `;

      const [runsResult, remixesResult] = await Promise.all([
        env.DB.prepare(runsQuery).bind(...capsuleIds).all(),
        env.DB.prepare(remixesQuery).bind(...capsuleIds).all(),
      ]);

      for (const row of runsResult.results || []) {
        runsByCapsule.set((row as any).capsule_id, Number((row as any).count ?? 0));
      }
      for (const row of remixesResult.results || []) {
        remixesByCapsule.set((row as any).parent_capsule_id, Number((row as any).count ?? 0));
      }
    }

    const posts = rows.map((row: any) => {
      const likeCount = likesByPost.get(row.id) ?? 0;
      const commentCount = commentsByPost.get(row.id) ?? 0;
      const runsCount = row.capsule_id ? runsByCapsule.get(row.capsule_id) ?? 0 : 0;
      const remixCount = row.capsule_id ? remixesByCapsule.get(row.capsule_id) ?? 0 : 0;

      return {
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        tags: row.tags ? JSON.parse(row.tags) : [],
        capsule: buildCapsuleSummary(row.capsule_id, row.manifest_json, {
          source: "profilePosts",
          postId: row.id,
        }),
        coverKey: row.cover_key ?? null,
        createdAt: row.created_at,
        stats: {
          likes: likeCount,
          comments: commentCount,
          remixes: remixCount,
          runs: runsCount,
        },
      };
    });

    const payload = { posts, limit, offset };
    const parsed = ApiUserPostsResponseSchema.parse(payload);
    return json(parsed);
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
export const checkFollowing: Handler = requireUser(async (req, env, ctx, params, userId) => {
  const url = new URL(req.url);
  const targetId = url.searchParams.get("targetId");

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
});

/**
 * GET /posts/:postId/check-liked
 * Check if current user has liked a post
 * Requires auth
 */
export const checkLiked: Handler = requireUser(async (req, env, ctx, params, userId) => {
  const postId = params.p1;

  if (!postId) {
    return json({ error: "postId required" }, 400);
  }

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
});
