// Social interaction handlers: likes, follows, comments, notifications
// References: research-social-platforms.md

import type { Handler, Env } from "../types";
import { requireUser, verifyAuth, isModeratorOrAdmin } from "../auth";
import { incrementPostStats, runCounterUpdate, ERROR_POST_STATS_UPDATE_FAILED } from "./counters";
import { createCommentBodySchema } from "../schema";
import { json } from "../lib/responses";

type Params = Record<string, string>;

const COMMENT_VALIDATION_ERROR = "E-VIBECODR-0400";
const COMMENT_PARENT_NOT_FOUND_ERROR = "E-VIBECODR-0401";
const COMMENT_PARENT_MISMATCH_ERROR = "E-VIBECODR-0402";

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

// ============================================================================
// LIKES
// ============================================================================

/**
 * POST /posts/:postId/like
 * Like a post and create notification for post author
 */
export const likePost: Handler = requireUser(async (req, env, ctx, params, userId) => {
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

      // Ensure post like count stays in sync; waitUntil prevents drops after response returns.
      await runCounterUpdate(ctx, () => incrementPostStats(env, postId, { likesDelta: 1 }), {
        code: ERROR_POST_STATS_UPDATE_FAILED,
        op: "likePost increment likes_count",
        details: { postId, userId },
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
export const unlikePost: Handler = requireUser(async (req, env, ctx, params, userId) => {
  const postId = params.p1;

  try {
    const result = await env.DB.prepare(
      "DELETE FROM likes WHERE user_id = ? AND post_id = ?"
    ).bind(userId, postId).run();

    // Only decrement if a row was deleted (idempotent)
    // D1 run() doesn't always return changes; attempt decrement but keep it reliable with waitUntil.
    await runCounterUpdate(ctx, () => incrementPostStats(env, postId, { likesDelta: -1 }), {
      code: ERROR_POST_STATS_UPDATE_FAILED,
      op: "unlikePost decrement likes_count",
      details: { postId, userId },
    });

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
export const followUser: Handler = requireUser(async (req, env, ctx, params, followerId) => {
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

    const notifId = generateId();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)").bind(followerId, followeeId),
      env.DB.prepare(`
        UPDATE users
        SET followers_count = MAX(followers_count + ?, 0)
        WHERE id = ?
      `).bind(1, followeeId),
      env.DB.prepare(`
        UPDATE users
        SET following_count = MAX(following_count + ?, 0)
        WHERE id = ?
      `).bind(1, followerId),
      env.DB.prepare(
        "INSERT INTO notifications (id, user_id, type, actor_id) VALUES (?, ?, 'follow', ?)"
      ).bind(notifId, followeeId, followerId),
    ]);

    return json({ ok: true, following: true });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return json({ ok: true, following: true, message: "Already following" });
    }
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
export const unfollowUser: Handler = requireUser(async (req, env, ctx, params, followerId) => {
  const followeeId = params.p1;

  try {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE users
        SET followers_count = MAX(followers_count + ?, 0)
        WHERE id = ?
          AND EXISTS (
            SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?
          )
      `).bind(-1, followeeId, followerId, followeeId),
      env.DB.prepare(`
        UPDATE users
        SET following_count = MAX(following_count + ?, 0)
        WHERE id = ?
          AND EXISTS (
            SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?
          )
      `).bind(-1, followerId, followerId, followeeId),
      env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?").bind(followerId, followeeId),
    ]);

    return json({ ok: true, following: false });
  } catch (error) {
    return json({
      error: "Failed to unfollow user",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /UNIQUE constraint/i.test(error.message || "");
}

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
 * Body: { body: string, atMs?: number, bbox?: string, parentCommentId?: string }
 */
export const createComment: Handler = requireUser(async (req, env, ctx, params, userId) => {
  const postId = params.p1;

  try {
    const payload = await req.json();
    const validation = createCommentBodySchema.safeParse(payload);

    if (!validation.success) {
      return json({
        error: "Invalid comment data",
        code: COMMENT_VALIDATION_ERROR,
        details: validation.error.flatten(),
      }, 400);
    }

    const { body: commentBody, atMs, bbox, parentCommentId } = validation.data;

    // Check if post exists and get author
    const post = await env.DB.prepare(
      "SELECT author_id FROM posts WHERE id = ?"
    ).bind(postId).first();

    if (!post) {
      return json({ error: "Post not found" }, 404);
    }

    // If replying to a comment, ensure the parent exists and belongs to the same post.
    let normalizedParentId: string | null = null;
    if (typeof parentCommentId === "string" && parentCommentId.trim().length > 0) {
      const parent = await env.DB.prepare(
        "SELECT post_id FROM comments WHERE id = ?"
      )
        .bind(parentCommentId)
        .first();

      if (!parent) {
        return json(
          {
            error: "Parent comment not found",
            code: COMMENT_PARENT_NOT_FOUND_ERROR,
          },
          400
        );
      }

      const parentPostId =
        parent && typeof parent === "object" ? (parent as { post_id?: unknown }).post_id : null;
      if (String(parentPostId) !== postId) {
        return json(
          {
            error: "Parent comment belongs to a different post",
            code: COMMENT_PARENT_MISMATCH_ERROR,
          },
          400
        );
      }

      normalizedParentId = parentCommentId;
    }

    // Create comment
    const commentId = generateId();
    await env.DB.prepare(`
      INSERT INTO comments (id, post_id, user_id, body, at_ms, bbox, parent_comment_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        commentId,
        postId,
        userId,
        commentBody,
        typeof atMs === "number" ? atMs : null,
        bbox ?? null,
        normalizedParentId
      )
      .run();

    // Keep post comment counters consistent; do not drop the update if the request returns early.
    await runCounterUpdate(ctx, () => incrementPostStats(env, postId, { commentsDelta: 1 }), {
      code: ERROR_POST_STATS_UPDATE_FAILED,
      op: "createComment increment comments_count",
      details: { postId, userId, commentId },
    });

    // Create notification for post author (but not if commenting on own post)
    if (post.author_id !== userId) {
      const notifId = generateId();
      await env.DB.prepare(
        "INSERT INTO notifications (id, user_id, type, actor_id, post_id, comment_id) VALUES (?, ?, 'comment', ?, ?, ?)"
      ).bind(notifId, post.author_id, userId, postId, commentId).run();
    }

    // Fetch the created comment with user info
    const comment = await env.DB.prepare(`
      SELECT c.id, c.body, c.at_ms, c.bbox, c.created_at,
             u.id as user_id, u.handle, u.name, u.avatar_url
      FROM comments c
      INNER JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `)
      .bind(commentId)
      .first();

    if (!comment || typeof comment !== "object") {
      return json({ error: "Failed to load created comment" }, 500);
    }
    const commentRow = comment as Record<string, unknown>;

    return json({
      comment: {
        id: commentRow.id,
        body: commentRow.body,
        atMs: commentRow.at_ms,
        bbox: commentRow.bbox,
        createdAt: commentRow.created_at,
        user: {
          id: commentRow.user_id,
          handle: commentRow.handle,
          name: commentRow.name,
          avatarUrl: commentRow.avatar_url,
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
    const authedUser = await verifyAuth(req, env);
    const isMod = !!(authedUser && isModeratorOrAdmin(authedUser));

    const base = `
      SELECT c.id, c.body, c.at_ms, c.bbox, c.parent_comment_id, c.created_at,
             u.id as user_id, u.handle, u.name, u.avatar_url
      FROM comments c
      INNER JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?`;

    const filtered = isMod
      ? `${base}
         ORDER BY c.created_at ASC
         LIMIT ? OFFSET ?`
      : `${base}
         AND (c.quarantined IS NULL OR c.quarantined = 0)
         ORDER BY c.created_at ASC
         LIMIT ? OFFSET ?`;

    const { results } = await env.DB.prepare(filtered).bind(postId, limit, offset).all();

    const comments = results?.map((row: any) => ({
      id: row.id,
      body: row.body,
      atMs: row.at_ms,
      bbox: row.bbox,
      parentCommentId: row.parent_comment_id || null,
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
export const deleteComment: Handler = requireUser(async (req, env, ctx, params, userId) => {
  const commentId = params.p1;

  try {
    // Check if comment exists and user is author or post author
    const row = await env.DB.prepare(
      `SELECT c.user_id as comment_user_id, c.post_id as post_id, p.author_id as post_author_id
       FROM comments c
       INNER JOIN posts p ON c.post_id = p.id
       WHERE c.id = ?`
    ).bind(commentId).first();

    if (!row || typeof row !== "object") {
      return json({ error: "Comment not found" }, 404);
    }

    const commentRow = row as { comment_user_id?: unknown; post_id?: unknown; post_author_id?: unknown };
    const commentAuthorId = typeof commentRow.comment_user_id === "string" ? commentRow.comment_user_id : null;
    const postAuthorId = typeof commentRow.post_author_id === "string" ? commentRow.post_author_id : null;
    const targetPostId = commentRow.post_id !== undefined && commentRow.post_id !== null ? String(commentRow.post_id) : "";

    if (commentAuthorId !== userId && postAuthorId !== userId) {
      return json({ error: "Forbidden" }, 403);
    }

    await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(commentId).run();

    if (targetPostId) {
      await runCounterUpdate(ctx, () => incrementPostStats(env, targetPostId, { commentsDelta: -1 }), {
        code: ERROR_POST_STATS_UPDATE_FAILED,
        op: "deleteComment decrement comments_count",
        details: { commentId, postId: targetPostId, userId },
      });
    }

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
export const getNotifications: Handler = requireUser(async (req, env, ctx, params, userId) => {
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
export const markNotificationsRead: Handler = requireUser(async (req, env, ctx, params, userId) => {
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
export const getUnreadCount: Handler = requireUser(async (req, env, ctx, params, userId) => {
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

/**
 * GET /notifications/summary?limit=20&offset=0
 * Get unread count and a page of notifications in a single payload
 */
export const getNotificationSummary: Handler = requireUser(async (req, env, ctx, params, userId) => {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  try {
    const countPromise = env.DB.prepare(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0"
    ).bind(userId).first();

    const listPromise = env.DB.prepare(`
      SELECT n.id, n.type, n.read, n.created_at,
             a.id as actor_id, a.handle as actor_handle, a.name as actor_name, a.avatar_url as actor_avatar,
             p.id as post_id, p.title as post_title,
             c.id as comment_id, c.body as comment_body
      FROM notifications n
      INNER JOIN users a ON n.actor_id = a.id
      LEFT JOIN posts p ON n.post_id = p.id
      LEFT JOIN comments c ON n.comment_id = c.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();

    const [countRow, list] = await Promise.all([countPromise, listPromise]);

    const notifications = list.results?.map((row: any) => ({
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
      post: row.post_id
        ? {
            id: row.post_id,
            title: row.post_title,
          }
        : null,
      comment: row.comment_id
        ? {
            id: row.comment_id,
            body: row.comment_body,
          }
        : null,
    })) || [];

    return json({
      unreadCount: toNumber((countRow as { count?: unknown } | null)?.count),
      notifications,
      limit,
      offset,
    });
  } catch (error) {
    return json({
      error: "Failed to fetch notification summary",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
