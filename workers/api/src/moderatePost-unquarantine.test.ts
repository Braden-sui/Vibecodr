import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "./types";
import type { AuthenticatedUser } from "./auth";

vi.mock("./auth", () => {
  return {
    requireAuth: (handler: any) =>
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

import { moderatePostAction } from "./handlers/moderation";

describe("moderatePostAction unquarantine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears the quarantined flag on a post", async () => {
    const state = {
      quarantined: 1,
      updatedTo: [] as number[],
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
              if (query.startsWith("UPDATE posts SET quarantined = 0")) {
                state.quarantined = 0;
                state.updatedTo.push(0);
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
      body: JSON.stringify({ action: "unquarantine" }),
    });

    const res = await moderatePostAction(req, env, {} as any, { p1: "post-1" });

    expect(res.status).toBe(200);
    expect(state.quarantined).toBe(0);
    expect(state.updatedTo).toContain(0);
  });
});
