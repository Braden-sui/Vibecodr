// Social interaction handlers: likes, follows, comments, notifications
// References: research-social-platforms.md

import type { Handler, Env } from "../index";
import { incrementPostStats, incrementUserCounters } from "./counters";

type Params = Record<string, string>;

/**
 * Helper to require authentication and extract user from Clerk session
 * In production, integrate with @clerk/backend
 */
function requireAuth(
  handler: (req: Request, env: Env, ctx: ExecutionContext, params: Params, userId: string) => Promise<Response>
): Handler {
  return async (req: Request, env: Env, ctx: ExecutionContext, params: Params) => {
    // TODO: Replace with actual Clerk session validation
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = authHeader.replace("Bearer ", "");
    return handler(req, env, ctx, params, userId);
  };
}

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init
  });
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// ============================================================================
// LIKES
// ============================================================================

/**
 * POST /posts/:postId/like
 * Like a post and create notification for post author
 */
export const likePost: Handler = requireAuth(async (req, env, ctx, params, userId) => {
  const postId = params.p1;

  try {
    // Check if post exists and get author
    const post = await env.DB.prepare(
      "SELECT author_id FROM posts WHERE id = ?"
    ).bind(postId).first();

    if (!post) {
      return json({ error: "Post not found" }, 404);
    }

    // Insert like (will fail silently if already liked due to PRIMARY KEY constraint)
    try {
      await env.DB.prepare(
        "INSERT INTO likes (user_id, post_id) VALUES (?, ?)"
      ).bind(userId, postId).run();

      // Best-effort: update post like stats (no-op today) and ignore failures
      incrementPostStats(env, postId, { likesDelta: 1 }).catch((err) => {
        console.error("E-API-0002 likePost counter update failed", {
          postId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Create notification for post author (but not if liking own post)
      if (post.author_id !== userId) {
        const notifId = generateId();
        await env.DB.prepare(
          "INSERT INTO notifications (id, user_id, type, actor_id, post_id) VALUES (?, ?, 'like', ?, ?)"
        ).bind(notifId, post.author_id, userId, postId).run();
      }

      return json({ ok: true, liked: true });
    } catch (e: any) {
      // Already liked
      if (e.message?.includes("UNIQUE constraint")) {
        return json({ ok: true, liked: true, message: "Already liked" });
      }
      throw e;
    }
  } catch (error) {
    return json({
      error: "Failed to like post",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

/**
 * DELETE /posts/:postId/like
 * Unlike a post
 */
export const unlikePost: Handler = requireAuth(async (req, env, ctx, params, userId) => {
  const postId = params.p1;

  try {
    const result = await env.DB.prepare(
      "DELETE FROM likes WHERE user_id = ? AND post_id = ?"
    ).bind(userId, postId).run();

    // Only decrement if a row was deleted (idempotent)
    try {
      // D1 run() doesn't always return changes; attempt best-effort decrement
      incrementPostStats(env, postId, { likesDelta: -1 }).catch((err) => {
        console.error("E-API-0003 unlikePost counter update failed", {
          postId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } catch {}

    return json({ ok: true, liked: false });
  } catch (error) {
    return json({
      error: "Failed to unlike post",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

/**
 * GET /posts/:postId/likes?limit=20&offset=0
 * Get list of users who liked a post
 */
export const getPostLikes: Handler = async (req: Request, env: Env, ctx: ExecutionContext, params: Params) => {
  const postId = params.p1;
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  try {
    const { results } = await env.DB.prepare(`
      SELECT u.id, u.handle, u.name, u.avatar_url, l.created_at
      FROM likes l
      INNER JOIN users u ON l.user_id = u.id
      WHERE l.post_id = ?
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(postId, limit, offset).all();

    const likes = results?.map((row: any) => ({
      user: {
        id: row.id,
        handle: row.handle,
        name: row.name,
        avatarUrl: row.avatar_url,
      },
      createdAt: row.created_at,
    })) || [];

    return json({ likes, limit, offset });
  } catch (error) {
    return json({
      error: "Failed to fetch likes",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
};

// ============================================================================
// FOLLOWS
// ============================================================================

/**
 * POST /users/:userId/follow
 * Follow a user and create notification
 */
export const followUser: Handler = requireAuth(async (req, env, ctx, params, followerId) => {
  const followeeId = params.p1;

  if (followerId === followeeId) {
    return json({ error: "Cannot follow yourself" }, 400);
  }

  try {
    // Check if followee exists
    const followee = await env.DB.prepare(
      "SELECT id FROM users WHERE id = ?"
    ).bind(followeeId).first();

    if (!followee) {
      return json({ error: "User not found" }, 404);
    }

    // Insert follow
    try {
      await env.DB.prepare(
        "INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)"
      ).bind(followerId, followeeId).run();

      // Best-effort: update counters (idempotent if UNIQUE prevented dupes)
      incrementUserCounters(env, followeeId, { followersDelta: 1 }).catch((err) => {
        console.error("E-API-0004 followUser followee counter failed", {
          followeeId,
          followerId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      incrementUserCounters(env, followerId, { followingDelta: 1 }).catch((err) => {
        console.error("E-API-0005 followUser follower counter failed", {
          followeeId,
          followerId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Create notification
      const notifId = generateId();
      await env.DB.prepare(
        "INSERT INTO notifications (id, user_id, type, actor_id) VALUES (?, ?, 'follow', ?)"
      ).bind(notifId, followeeId, followerId).run();

      return json({ ok: true, following: true });
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint")) {
        return json({ ok: true, following: true, message: "Already following" });
      }
      throw e;
    }
  } catch (error) {
    return json({
      error: "Failed to follow user",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

/**
 * DELETE /users/:userId/follow
 * Unfollow a user
 */
export const unfollowUser: Handler = requireAuth(async (req, env, ctx, params, followerId) => {
  const followeeId = params.p1;

  try {
    const res = await env.DB.prepare(
      "DELETE FROM follows WHERE follower_id = ? AND followee_id = ?"
    ).bind(followerId, followeeId).run();

    // Best-effort: decrement counters only when a row likely existed
    try {
      incrementUserCounters(env, followeeId, { followersDelta: -1 }).catch((err) => {
        console.error("E-API-0006 unfollowUser followee counter failed", {
          followeeId,
          followerId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      incrementUserCounters(env, followerId, { followingDelta: -1 }).catch((err) => {
        console.error("E-API-0007 unfollowUser follower counter failed", {
          followeeId,
          followerId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } catch {}

    return json({ ok: true, following: false });
  } catch (error) {
    return json({
      error: "Failed to unfollow user",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

/**
 * GET /users/:userId/followers?limit=20&offset=0
 * Get list of followers for a user
 */
export const getUserFollowers: Handler = async (req: Request, env: Env, ctx: ExecutionContext, params: Params) => {
  const userId = params.p1;
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  try {
    const { results } = await env.DB.prepare(`
      SELECT u.id, u.handle, u.name, u.avatar_url, u.bio
      FROM follows f
      INNER JOIN users u ON f.follower_id = u.id
      WHERE f.followee_id = ?
      ORDER BY u.handle ASC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();

    const followers = results?.map((row: any) => ({
      id: row.id,
      handle: row.handle,
      name: row.name,
      avatarUrl: row.avatar_url,
      bio: row.bio,
    })) || [];

    return json({ followers, limit, offset });
  } catch (error) {
    return json({
      error: "Failed to fetch followers",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
};

/**
 * GET /users/:userId/following?limit=20&offset=0
 * Get list of users that this user follows
 */
export const getUserFollowing: Handler = async (req: Request, env: Env, ctx: ExecutionContext, params: Params) => {
  const userId = params.p1;
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  try {
    const { results } = await env.DB.prepare(`
      SELECT u.id, u.handle, u.name, u.avatar_url, u.bio
      FROM follows f
      INNER JOIN users u ON f.followee_id = u.id
      WHERE f.follower_id = ?
      ORDER BY u.handle ASC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();

    const following = results?.map((row: any) => ({
      id: row.id,
      handle: row.handle,
      name: row.name,
      avatarUrl: row.avatar_url,
      bio: row.bio,
    })) || [];

    return json({ following, limit, offset });
  } catch (error) {
    return json({
      error: "Failed to fetch following",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
};

// ============================================================================
// COMMENTS
// ============================================================================

/**
 * POST /posts/:postId/comments
 * Create a comment on a post
 * Body: { body: string, atMs?: number, bbox?: string }
 */
export const createComment: Handler = requireAuth(async (req, env, ctx, params, userId) => {
  const postId = params.p1;

  try {
    const body = (await req.json()) as { body?: string; atMs?: number; bbox?: string | null };
    const { body: commentBody, atMs, bbox } = body;

    if (!commentBody || typeof commentBody !== "string" || commentBody.trim().length === 0) {
      return json({ error: "Comment body is required" }, 400);
    }

    if (commentBody.length > 2000) {
      return json({ error: "Comment body too long (max 2000 characters)" }, 400);
    }

    // Check if post exists and get author
    const post = await env.DB.prepare(
      "SELECT author_id FROM posts WHERE id = ?"
    ).bind(postId).first();

    if (!post) {
      return json({ error: "Post not found" }, 404);
    }

    // Create comment
    const commentId = generateId();
    await env.DB.prepare(`
      INSERT INTO comments (id, post_id, user_id, body, at_ms, bbox)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(commentId, postId, userId, commentBody.trim(), atMs || null, bbox || null).run();

    // Create notification for post author (but not if commenting on own post)
    if (post.author_id !== userId) {
      const notifId = generateId();
      await env.DB.prepare(
        "INSERT INTO notifications (id, user_id, type, actor_id, post_id, comment_id) VALUES (?, ?, 'comment', ?, ?, ?)"
      ).bind(notifId, post.author_id, userId, postId, commentId).run();
    }

    // Fetch the created comment with user info
    const comment = (await env.DB.prepare(`
      SELECT c.id, c.body, c.at_ms, c.bbox, c.created_at,
             u.id as user_id, u.handle, u.name, u.avatar_url
      FROM comments c
      INNER JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `).bind(commentId).first()) as any | null;

    if (!comment) {
      return json({ error: "Failed to load created comment" }, 500);
    }

    return json({
      comment: {
        id: comment.id,
        body: comment.body,
        atMs: comment.at_ms,
        bbox: comment.bbox,
        createdAt: comment.created_at,
        user: {
          id: comment.user_id,
          handle: comment.handle,
          name: comment.name,
          avatarUrl: comment.avatar_url,
        },
      },
    }, 201);
  } catch (error) {
    return json({
      error: "Failed to create comment",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

/**
 * GET /posts/:postId/comments?limit=50&offset=0
 * Get comments for a post
 */
export const getPostComments: Handler = async (req: Request, env: Env, ctx: ExecutionContext, params: Params) => {
  const postId = params.p1;
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  try {
    const { results } = await env.DB.prepare(`
      SELECT c.id, c.body, c.at_ms, c.bbox, c.created_at,
             u.id as user_id, u.handle, u.name, u.avatar_url
      FROM comments c
      INNER JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
      LIMIT ? OFFSET ?
    `).bind(postId, limit, offset).all();

    const comments = results?.map((row: any) => ({
      id: row.id,
      body: row.body,
      atMs: row.at_ms,
      bbox: row.bbox,
      createdAt: row.created_at,
      user: {
        id: row.user_id,
        handle: row.handle,
        name: row.name,
        avatarUrl: row.avatar_url,
      },
    })) || [];

    return json({ comments, limit, offset });
  } catch (error) {
    return json({
      error: "Failed to fetch comments",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
};

/**
 * DELETE /comments/:commentId
 * Delete a comment (only by author)
 */
export const deleteComment: Handler = requireAuth(async (req, env, ctx, params, userId) => {
  const commentId = params.p1;

  try {
    // Check if comment exists and user is author
    const comment = await env.DB.prepare(
      "SELECT user_id FROM comments WHERE id = ?"
    ).bind(commentId).first();

    if (!comment) {
      return json({ error: "Comment not found" }, 404);
    }

    if (comment.user_id !== userId) {
      return json({ error: "Forbidden" }, 403);
    }

    await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(commentId).run();

    return json({ ok: true });
  } catch (error) {
    return json({
      error: "Failed to delete comment",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

// ============================================================================
// NOTIFICATIONS
// ============================================================================

/**
 * GET /notifications?limit=20&offset=0&unreadOnly=false
 * Get notifications for current user
 */
export const getNotifications: Handler = requireAuth(async (req, env, ctx, params, userId) => {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";

  try {
    let query = `
      SELECT n.id, n.type, n.read, n.created_at,
             a.id as actor_id, a.handle as actor_handle, a.name as actor_name, a.avatar_url as actor_avatar,
             p.id as post_id, p.title as post_title,
             c.id as comment_id, c.body as comment_body
      FROM notifications n
      INNER JOIN users a ON n.actor_id = a.id
      LEFT JOIN posts p ON n.post_id = p.id
      LEFT JOIN comments c ON n.comment_id = c.id
      WHERE n.user_id = ?
    `;

    if (unreadOnly) {
      query += " AND n.read = 0";
    }

    query += " ORDER BY n.created_at DESC LIMIT ? OFFSET ?";

    const { results } = await env.DB.prepare(query).bind(userId, limit, offset).all();

    const notifications = results?.map((row: any) => ({
      id: row.id,
      type: row.type,
      read: row.read === 1,
      createdAt: row.created_at,
      actor: {
        id: row.actor_id,
        handle: row.actor_handle,
        name: row.actor_name,
        avatarUrl: row.actor_avatar,
      },
      post: row.post_id ? {
        id: row.post_id,
        title: row.post_title,
      } : null,
      comment: row.comment_id ? {
        id: row.comment_id,
        body: row.comment_body,
      } : null,
    })) || [];

    return json({ notifications, limit, offset });
  } catch (error) {
    return json({
      error: "Failed to fetch notifications",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

/**
 * POST /notifications/mark-read
 * Mark notifications as read
 * Body: { notificationIds: string[] } or {} to mark all as read
 */
export const markNotificationsRead: Handler = requireAuth(async (req, env, ctx, params, userId) => {
  try {
    const body = (await req.json()) as { notificationIds?: string[] };
    const { notificationIds } = body;

    if (notificationIds && Array.isArray(notificationIds)) {
      // Mark specific notifications as read
      const placeholders = notificationIds.map(() => "?").join(",");
      await env.DB.prepare(
        `UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`
      ).bind(userId, ...notificationIds).run();
    } else {
      // Mark all as read
      await env.DB.prepare(
        "UPDATE notifications SET read = 1 WHERE user_id = ?"
      ).bind(userId).run();
    }

    return json({ ok: true });
  } catch (error) {
    return json({
      error: "Failed to mark notifications as read",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

/**
 * GET /notifications/unread-count
 * Get count of unread notifications
 */
export const getUnreadCount: Handler = requireAuth(async (req, env, ctx, params, userId) => {
  try {
    const result = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0"
    ).bind(userId).first();

    return json({ count: Number(result?.count ?? 0) });
  } catch (error) {
    return json({
      error: "Failed to get unread count",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});
