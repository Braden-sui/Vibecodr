import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "./index";
import type { AuthenticatedUser } from "./auth";

vi.mock("./auth", () => {
  return {
    requireAuth:
      (handler: any) =>
      (req: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>) => {
        const user: AuthenticatedUser = {
          userId: "mod-1",
          sessionId: "sess-1",
          claims: {
            iss: "https://clerk.example",
            sub: "mod-1",
            exp: Math.floor(Date.now() / 1000) + 3600,
            role: "moderator",
          } as any,
        };
        return handler(req, env, ctx, params, user);
      },
    isModeratorOrAdmin: () => true,
    requireUser: (handler: any) => handler,
    requireAdmin: (handler: any) => handler,
    verifyAuth: vi.fn(),
  };
});

import { resolveModerationReport, moderatePostAction, moderateCommentAction } from "./handlers/moderation";

describe("moderation audit logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes audit log when resolving a report", async () => {
    const state = {
      auditInserts: [] as Array<{
        moderatorId: string;
        action: string;
        targetType: string;
        targetId: string;
        notes: string | null;
      }>,
    };

    const env = {
      DB: {
        prepare(query: string) {
          const prepared = {
            query,
            args: [] as any[],
            bind(...args: any[]) {
              prepared.args = args;
              return prepared;
            },
            async first() {
              if (query.startsWith("SELECT COUNT(*) as count FROM moderation_audit_log")) {
                return { count: 0 };
              }
              if (query.startsWith("SELECT * FROM moderation_reports WHERE id = ?")) {
                return {
                  id: "report-1",
                  target_type: "post",
                  target_id: "post-1",
                };
              }
              return null;
            },
            async run() {
              if (query.includes("INSERT INTO moderation_audit_log")) {
                const [, moderatorId, action, targetType, targetId, notes] = prepared.args;
                state.auditInserts.push({
                  moderatorId,
                  action,
                  targetType,
                  targetId,
                  notes: (notes as string | null) ?? null,
                });
              }
              return {};
            },
            async all() {
              return { results: [] };
            },
          };
          return prepared;
        },
      },
    } as unknown as Env;

    const req = new Request("https://example.com/moderation/reports/report-1/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "quarantine", notes: "spam" }),
    });

    const res = await resolveModerationReport(req, env, {} as any, { p1: "report-1" });

    expect(res.status).toBe(200);
    expect(state.auditInserts).toHaveLength(1);
    const record = state.auditInserts[0];
    expect(record.moderatorId).toBe("mod-1");
    expect(record.action).toBe("quarantine");
    expect(record.targetType).toBe("post");
    expect(record.targetId).toBe("post-1");
    expect(record.notes).toBe("spam");
  });

  it("writes audit log for direct post moderation", async () => {
    const state = {
      auditInserts: [] as Array<{ action: string; targetType: string; targetId: string }>,
    };

    const env = {
      DB: {
        prepare(query: string) {
          const prepared = {
            query,
            args: [] as any[],
            bind(...args: any[]) {
              prepared.args = args;
              return prepared;
            },
            async first() {
              if (query.startsWith("SELECT COUNT(*) as count FROM moderation_audit_log")) {
                return { count: 0 };
              }
              if (query.startsWith("SELECT id FROM posts WHERE id = ?")) {
                return { id: prepared.args[0] };
              }
              return null;
            },
            async run() {
              if (query.startsWith("UPDATE posts SET quarantined = 1")) {
                return {};
              }
              if (query.includes("INSERT INTO moderation_audit_log")) {
                const [, , action, targetType, targetId] = prepared.args;
                state.auditInserts.push({
                  action,
                  targetType,
                  targetId,
                });
              }
              if (query.startsWith("UPDATE moderation_reports")) {
                return {};
              }
              return {};
            },
            async all() {
              return { results: [] };
            },
          };
          return prepared;
        },
      },
    } as unknown as Env;

    const req = new Request("https://example.com/moderation/posts/post-1/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "quarantine", notes: "abuse" }),
    });

    const res = await moderatePostAction(req, env, {} as any, { p1: "post-1" });

    expect(res.status).toBe(200);
    expect(state.auditInserts).toHaveLength(1);
    const record = state.auditInserts[0];
    expect(record.action).toBe("quarantine");
    expect(record.targetType).toBe("post");
    expect(record.targetId).toBe("post-1");
  });

  it("writes audit log for direct comment moderation", async () => {
    const state = {
      auditInserts: [] as Array<{ action: string; targetType: string; targetId: string }>,
    };

    const env = {
      DB: {
        prepare(query: string) {
          const prepared = {
            query,
            args: [] as any[],
            bind(...args: any[]) {
              prepared.args = args;
              return prepared;
            },
            async first() {
              if (query.startsWith("SELECT COUNT(*) as count FROM moderation_audit_log")) {
                return { count: 0 };
              }
              if (query.startsWith("SELECT id FROM comments WHERE id = ?")) {
                return { id: prepared.args[0] };
              }
              return null;
            },
            async run() {
              if (query.startsWith("UPDATE comments SET quarantined = 1")) {
                return {};
              }
              if (query.includes("INSERT INTO moderation_audit_log")) {
                const [, , action, targetType, targetId] = prepared.args;
                state.auditInserts.push({
                  action,
                  targetType,
                  targetId,
                });
              }
              return {};
            },
            async all() {
              return { results: [] };
            },
          };
          return prepared;
        },
      },
    } as unknown as Env;

    const req = new Request("https://example.com/moderation/comments/comment-1/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "quarantine" }),
    });

    const res = await moderateCommentAction(req, env, {} as any, { p1: "comment-1" });

    expect(res.status).toBe(200);
    expect(state.auditInserts).toHaveLength(1);
    const record = state.auditInserts[0];
    expect(record.action).toBe("quarantine");
    expect(record.targetType).toBe("comment");
    expect(record.targetId).toBe("comment-1");
  });
});

