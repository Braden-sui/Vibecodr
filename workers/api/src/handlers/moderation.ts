// Moderation and safety handlers
// References: checklist.mdx Section 11 (Moderation & Safety)

import type { Handler, Env } from "../index";
import { requireAuth as requireWorkerAuth, isModeratorOrAdmin, type AuthenticatedUser, requireUser, requireAdmin } from "../auth";

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init
  });
}

const requireModerator = (
  handler: (
    req: Request,
    env: Env,
    ctx: ExecutionContext,
    params: Record<string, string>,
    user: AuthenticatedUser
  ) => Promise<Response>
): Handler =>
  requireWorkerAuth(async (req, env, ctx, params, user) => {
    if (!isModeratorOrAdmin(user)) {
      try {
        const url = new URL(req.url);
        console.error("E-VIBECODR-0002 moderation access denied", {
          userId: user.userId,
          path: url.pathname,
        });
      } catch {
        console.error("E-VIBECODR-0002 moderation access denied", {
          userId: user.userId,
        });
      }

      return json({ error: "Forbidden" }, 403);
    }

    return handler(req, env, ctx, params, user);
  });

/**
 * GET /moderation/flagged-posts?status=pending&limit=50&offset=0
 * List posts that have been flagged by users, sorted by number of flags (mods/admins only)
 */
export const getFlaggedPosts: Handler = requireModerator(async (req: Request, env: Env, _ctx, _params, _user) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "pending";
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  // Aggregate reports by post and join basic post + author info
  const { results } = await env.DB.prepare(`
    SELECT
      p.id,
      p.title,
      p.description,
      p.tags,
      p.created_at,
      u.id as author_id,
      u.handle as author_handle,
      u.name as author_name,
      u.avatar_url as author_avatar,
      COUNT(r.id) as flag_count
    FROM moderation_reports r
    INNER JOIN posts p ON r.target_type = 'post' AND r.target_id = p.id
    INNER JOIN users u ON p.author_id = u.id
    WHERE r.status = ?
    GROUP BY p.id
    ORDER BY flag_count DESC, p.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(status, limit, offset).all();

  const items = (results || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    tags: row.tags ? JSON.parse(row.tags) : [],
    createdAt: row.created_at,
    author: {
      id: row.author_id,
      handle: row.author_handle,
      name: row.author_name,
      avatarUrl: row.author_avatar,
    },
    // Intentionally not surfaced to general users; mods may use for sorting/debug
    flags: Number(row.flag_count || 0),
  }));

  return json({ items, limit, offset });
});

/**
 * GET /moderation/audit?limit=100&offset=0
 * Admin-only audit trail of moderation actions
 */
export const getModerationAudit: Handler = requireAdmin(async (req: Request, env: Env, _ctx, _params, _user) => {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const { results } = await env.DB.prepare(`
    SELECT id, moderator_id, action, target_type, target_id, notes, created_at
    FROM moderation_audit_log
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  const entries = (results || []).map((row: any) => ({
    id: row.id,
    moderatorId: row.moderator_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    notes: row.notes,
    createdAt: row.created_at,
  }));

  return json({ entries, limit, offset });
});

export const getPostModerationStatus: Handler = requireModerator(async (req: Request, env: Env, _ctx, params, _user) => {
  const postId = params.p1;

  if (!postId) {
    return json({ error: "postId required" }, 400);
  }

  try {
    const postRow = await env.DB.prepare(
      "SELECT quarantined FROM posts WHERE id = ?"
    ).bind(postId).first();

    if (!postRow) {
      return json({ error: "Post not found" }, 404);
    }

    const pendingRow = await env.DB.prepare(
      "SELECT COUNT(*) as pending_flags FROM moderation_reports WHERE target_type = 'post' AND target_id = ? AND status = 'pending'"
    ).bind(postId).first();

    const pendingFlags = Number((pendingRow as any)?.pending_flags ?? 0);

    return json({
      postId,
      quarantined: ((postRow as any).quarantined ?? 0) === 1,
      pendingFlags,
    });
  } catch (error) {
    return json(
      {
        error: "Failed to fetch moderation status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});
 
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

async function enforceModeratorRateLimit(env: Env, moderatorId: string, maxPerMinute: number): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM moderation_audit_log WHERE moderator_id = ? AND created_at >= (strftime('%s','now') - 60)"
  ).bind(moderatorId).first();
  const count = Number((row as any)?.count ?? 0);
  return count < maxPerMinute;
}

// Basic keyword filter for spam/abuse detection
const BLOCKED_KEYWORDS = [
  // Spam indicators
  "buy now", "click here", "limited time", "act now",
  // Extreme profanity (basic list for MVP)
  "fuck", "shit", "bitch", "asshole",
  // Add more as needed based on moderation needs
];

/**
 * Check content for blocked keywords
 */
function containsBlockedKeywords(text: string): { blocked: boolean; matches: string[] } {
  const lowerText = text.toLowerCase();
  const matches: string[] = [];

  for (const keyword of BLOCKED_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      matches.push(keyword);
    }
  }

  return {
    blocked: matches.length > 0,
    matches,
  };
}

/**
 * POST /moderation/report
 * Report a post or comment for moderation
 *
 * Body: {
 *   targetType: "post" | "comment",
 *   targetId: string,
 *   reason: "spam" | "harassment" | "inappropriate" | "copyright" | "other",
 *   details?: string
 * }
 */
export const reportContent: Handler = requireUser(async (req, env, ctx, params, userId) => {
  try {
    const body = await req.json() as {
      targetType?: string;
      targetId?: string;
      reason?: string;
      details?: string | null;
    };
    const { targetType, targetId, reason, details } = body;

    // Validate inputs
    if (!targetType || !["post", "comment"].includes(targetType)) {
      return json({ error: "Invalid targetType (must be 'post' or 'comment')" }, 400);
    }

    if (!targetId || typeof targetId !== "string") {
      return json({ error: "Invalid targetId" }, 400);
    }

    const validReasons = ["spam", "harassment", "inappropriate", "copyright", "other"];
    if (!reason || !validReasons.includes(reason)) {
      return json({ error: `Invalid reason (must be one of: ${validReasons.join(", ")})` }, 400);
    }

    // Check if target exists
    if (targetType === "post") {
      const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ?")
        .bind(targetId).first();
      if (!post) {
        return json({ error: "Post not found" }, 404);
      }
    } else if (targetType === "comment") {
      const comment = await env.DB.prepare("SELECT id FROM comments WHERE id = ?")
        .bind(targetId).first();
      if (!comment) {
        return json({ error: "Comment not found" }, 404);
      }
    }

    // Check if user already reported this content
    const existingReport = await env.DB.prepare(
      "SELECT id FROM moderation_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ?"
    ).bind(userId, targetType, targetId).first();

    if (existingReport) {
      return json({ error: "You have already reported this content" }, 400);
    }

    // Create report
    const reportId = generateId();
    await env.DB.prepare(`
      INSERT INTO moderation_reports (id, reporter_id, target_type, target_id, reason, details, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).bind(reportId, userId, targetType, targetId, reason, details || null).run();

    return json({
      reportId,
      message: "Report submitted successfully. Our moderation team will review it.",
    }, 201);
  } catch (error) {
    return json({
      error: "Failed to submit report",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

/**
 * GET /moderation/reports?status=pending&limit=50&offset=0
 * Get moderation reports (admin only)
 */
export const getModerationReports: Handler = requireModerator(async (req, env, ctx, params, user) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "pending";
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const { results } = await env.DB.prepare(`
      SELECT
        r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
        u.id as reporter_id, u.handle as reporter_handle
      FROM moderation_reports r
      INNER JOIN users u ON r.reporter_id = u.id
      WHERE r.status = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(status, limit, offset).all();

    const reports = results?.map((row: any) => ({
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      reason: row.reason,
      details: row.details,
      status: row.status,
      createdAt: row.created_at,
      reporter: {
        id: row.reporter_id,
        handle: row.reporter_handle,
      },
    })) || [];

    return json({ reports, limit, offset });
  } catch (error) {
    return json({
      error: "Failed to fetch reports",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

/**
 * POST /moderation/reports/:reportId/resolve
 * Resolve a moderation report (admin only)
 *
 * Body: {
 *   action: "dismiss" | "quarantine" | "remove",
 *   notes?: string
 * }
 */
export const resolveModerationReport: Handler = requireModerator(async (req, env, ctx, params, user) => {
  const reportId = params.p1;

  try {
    // Per-moderator rate limit: max 30 actions/minute
    const allowed = await enforceModeratorRateLimit(env, user.userId, 30);
    if (!allowed) {
      return json({ error: "Too Many Requests", message: "Moderation actions rate limit exceeded (30/min)" }, 429);
    }

    const body = await req.json() as {
      action?: "dismiss" | "quarantine" | "remove";
      notes?: string | null;
    };
    const { action, notes } = body;

    if (!action || !["dismiss", "quarantine", "remove"].includes(action)) {
      return json({ error: "Invalid action (must be 'dismiss', 'quarantine', or 'remove')" }, 400);
    }

    // Get report
    const report = await env.DB.prepare(
      "SELECT * FROM moderation_reports WHERE id = ?"
    ).bind(reportId).first();

    if (!report) {
      return json({ error: "Report not found" }, 404);
    }

    // Take action
    if (action === "quarantine") {
      try {
        if (report.target_type === "post") {
          await env.DB.prepare("UPDATE posts SET quarantined = 1 WHERE id = ?")
            .bind(report.target_id).run();
        } else if (report.target_type === "comment") {
          await env.DB.prepare("UPDATE comments SET quarantined = 1 WHERE id = ?")
            .bind(report.target_id).run();
        }
      } catch (error) {
        console.error("E-VIBECODR-0102 quarantine action failed", {
          reportId,
          targetType: report.target_type,
          targetId: report.target_id,
          error: error instanceof Error ? error.message : String(error),
        });

        return json({
          error: "Quarantine action is currently unavailable. Please contact an administrator.",
        }, 503);
      }
    } else if (action === "remove") {
      if (report.target_type === "post") {
        await env.DB.prepare("DELETE FROM posts WHERE id = ?")
          .bind(report.target_id).run();
      } else if (report.target_type === "comment") {
        await env.DB.prepare("DELETE FROM comments WHERE id = ?")
          .bind(report.target_id).run();
      }
    }

    // Update report status
    await env.DB.prepare(`
      UPDATE moderation_reports
      SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_action = ?, resolution_notes = ?
      WHERE id = ?
    `).bind(user.userId, Math.floor(Date.now() / 1000), action, notes || null, reportId).run();

    // Create audit log entry
    const auditId = generateId();
    await env.DB.prepare(`
      INSERT INTO moderation_audit_log (id, moderator_id, action, target_type, target_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(auditId, user.userId, action, report.target_type, report.target_id, notes || null).run();

    return json({
      message: "Report resolved successfully",
      action,
    });
  } catch (error) {
    return json({
      error: "Failed to resolve report",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

/**
 * POST /moderation/posts/:postId/action
 * Direct moderation actions on a post (admin/moderator only)
 *
 * Body: {
 *   action: "quarantine" | "remove",
 *   notes?: string
 * }
 */
export const moderatePostAction: Handler = requireModerator(async (req, env, ctx, params, user) => {
  const postId = params.p1;

  try {
    // Per-moderator rate limit: max 30 actions/minute
    const allowed = await enforceModeratorRateLimit(env, user.userId, 30);
    if (!allowed) {
      return json({ error: "Too Many Requests", message: "Moderation actions rate limit exceeded (30/min)" }, 429);
    }

    const body = await req.json() as {
      action?: "quarantine" | "remove";
      notes?: string | null;
    };
    const { action, notes } = body;

    if (!action || !["quarantine", "remove"].includes(action)) {
      return json({ error: "Invalid action (must be 'quarantine' or 'remove')" }, 400);
    }

    const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ?")
      .bind(postId).first();

    if (!post) {
      return json({ error: "Post not found" }, 404);
    }

    if (action === "quarantine") {
      try {
        await env.DB.prepare("UPDATE posts SET quarantined = 1 WHERE id = ?")
          .bind(postId).run();
      } catch (error) {
        console.error("E-VIBECODR-0103 direct quarantine failed", {
          postId,
          error: error instanceof Error ? error.message : String(error),
        });

        return json({
          error: "Quarantine action is currently unavailable. Please contact an administrator.",
        }, 503);
      }
    } else if (action === "remove") {
      await env.DB.prepare("DELETE FROM posts WHERE id = ?")
        .bind(postId).run();
    }

    await env.DB.prepare(`
      UPDATE moderation_reports
      SET status = 'resolved',
          resolved_by = ?,
          resolved_at = ?,
          resolution_action = ?,
          resolution_notes = COALESCE(resolution_notes, ?)
      WHERE target_type = 'post' AND target_id = ? AND status = 'pending'
    `).bind(user.userId, Math.floor(Date.now() / 1000), action, notes || null, postId).run();

    const auditId = generateId();
    await env.DB.prepare(`
      INSERT INTO moderation_audit_log (id, moderator_id, action, target_type, target_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(auditId, user.userId, action, "post", postId, notes || null).run();

    return json({
      message: "Moderation action applied",
      action,
    });
  } catch (error) {
    return json({
      error: "Failed to apply moderation action",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

/**
 * POST /moderation/comments/:commentId/action
 * Direct moderation actions on a comment (admin/moderator only)
 *
 * Body: {
 *   action: "quarantine" | "remove",
 *   notes?: string
 * }
 */
export const moderateCommentAction: Handler = requireModerator(async (req, env, ctx, params, user) => {
  const commentId = params.p1;

  try {
    // Per-moderator rate limit: max 30 actions/minute
    const allowed = await enforceModeratorRateLimit(env, user.userId, 30);
    if (!allowed) {
      return json({ error: "Too Many Requests", message: "Moderation actions rate limit exceeded (30/min)" }, 429);
    }

    const body = await req.json() as {
      action?: "quarantine" | "remove";
      notes?: string | null;
    };
    const { action, notes } = body;

    if (!action || !["quarantine", "remove"].includes(action)) {
      return json({ error: "Invalid action (must be 'quarantine' or 'remove')" }, 400);
    }

    const comment = await env.DB.prepare("SELECT id FROM comments WHERE id = ?")
      .bind(commentId).first();

    if (!comment) {
      return json({ error: "Comment not found" }, 404);
    }

    if (action === "quarantine") {
      try {
        await env.DB.prepare("UPDATE comments SET quarantined = 1 WHERE id = ?")
          .bind(commentId).run();
      } catch (error) {
        console.error("E-VIBECODR-0104 direct comment quarantine failed", {
          commentId,
          error: error instanceof Error ? error.message : String(error),
        });

        return json({
          error: "Quarantine action is currently unavailable. Please contact an administrator.",
        }, 503);
      }
    } else if (action === "remove") {
      await env.DB.prepare("DELETE FROM comments WHERE id = ?")
        .bind(commentId).run();
    }

    const auditId = generateId();
    await env.DB.prepare(`
      INSERT INTO moderation_audit_log (id, moderator_id, action, target_type, target_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(auditId, user.userId, action, "comment", commentId, notes || null).run();

    return json({
      message: "Comment moderation action applied",
      action,
    });
  } catch (error) {
    return json({
      error: "Failed to apply comment moderation action",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

/**
 * POST /moderation/filter-content
 * Filter content for blocked keywords (used before creating posts/comments)
 *
 * Body: { content: string }
 * Returns: { allowed: boolean, blocked?: string[] }
 */
export const filterContent: Handler = async (req, env) => {
  try {
    const body = await req.json() as { content?: string };
    const { content } = body;

    if (!content || typeof content !== "string") {
      return json({ error: "Invalid content" }, 400);
    }

    const result = containsBlockedKeywords(content);

    if (result.blocked) {
      return json({
        allowed: false,
        blocked: result.matches,
        message: "Content contains blocked keywords",
      });
    }

    return json({ allowed: true });
  } catch (error) {
    return json({
      error: "Failed to filter content",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
};
