// Moderation and safety handlers
// References: checklist.mdx Section 11 (Moderation & Safety)

import type { Handler } from "../index";

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

/**
 * Helper to require authentication
 */
function requireAuth(handler: (req: Request, env: any, ctx: ExecutionContext, params: Record<string, string>, userId: string) => Promise<Response>): Handler {
  return async (req, env, ctx, params) => {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = authHeader.replace("Bearer ", "");
    return handler(req, env, ctx, params, userId);
  };
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
export const reportContent: Handler = requireAuth(async (req, env, ctx, params, userId) => {
  try {
    const body = await req.json();
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

    // Auto-quarantine if multiple reports (basic auto-moderation)
    const reportCount = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM moderation_reports WHERE target_type = ? AND target_id = ?"
    ).bind(targetType, targetId).first();

    // If 3 or more reports, auto-quarantine
    if (reportCount && reportCount.count >= 3) {
      if (targetType === "post") {
        await env.DB.prepare("UPDATE posts SET quarantined = 1 WHERE id = ?")
          .bind(targetId).run();
      } else if (targetType === "comment") {
        await env.DB.prepare("UPDATE comments SET quarantined = 1 WHERE id = ?")
          .bind(targetId).run();
      }
    }

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
export const getModerationReports: Handler = requireAuth(async (req, env, ctx, params, userId) => {
  try {
    // TODO: Check if user is admin/moderator
    // For now, any authenticated user can view (should be restricted in production)

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
export const resolveModerationReport: Handler = requireAuth(async (req, env, ctx, params, userId) => {
  const reportId = params.p1;

  try {
    // TODO: Check if user is admin/moderator

    const body = await req.json();
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
      if (report.target_type === "post") {
        await env.DB.prepare("UPDATE posts SET quarantined = 1 WHERE id = ?")
          .bind(report.target_id).run();
      } else if (report.target_type === "comment") {
        await env.DB.prepare("UPDATE comments SET quarantined = 1 WHERE id = ?")
          .bind(report.target_id).run();
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
    `).bind(userId, Math.floor(Date.now() / 1000), action, notes || null, reportId).run();

    // Create audit log entry
    const auditId = generateId();
    await env.DB.prepare(`
      INSERT INTO moderation_audit_log (id, moderator_id, action, target_type, target_id, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(auditId, userId, action, report.target_type, report.target_id, notes || null).run();

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
 * POST /moderation/filter-content
 * Filter content for blocked keywords (used before creating posts/comments)
 *
 * Body: { content: string }
 * Returns: { allowed: boolean, blocked?: string[] }
 */
export const filterContent: Handler = async (req, env) => {
  try {
    const body = await req.json();
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
