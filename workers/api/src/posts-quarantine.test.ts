import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "./index";
import type { AuthenticatedUser } from "./auth";

vi.mock("./auth", () => {
  return {
    verifyAuth: vi.fn(),
    isModeratorOrAdmin: vi.fn(),
    requireUser: (handler: unknown) => handler,
    requireAuth: (handler: unknown) => handler,
    requireAdmin: (handler: unknown) => handler,
  };
});

import { getPostById } from "./index";
import { verifyAuth, isModeratorOrAdmin } from "./auth";

type DbRow = Record<string, any>;

function makeDb(row: DbRow) {
  return {
    prepare(query: string) {
      const state = {
        query,
        args: [] as any[],
        bind(...args: any[]) {
          state.args = args;
          return state;
        },
        async all() {
          if (query.includes("FROM posts") && query.includes("WHERE p.id = ?")) {
            if (query.includes("p.quarantined")) {
              // Non-moderator path: quarantined posts should be filtered out by the query
              return { results: [] };
            }
            // Moderator path: return the quarantined post row
            return { results: [row] };
          }
          return { results: [] };
        },
        async first() {
          if (query.startsWith("SELECT COUNT(*) as count FROM")) {
            return { count: 0 };
          }
          return null;
        },
      };
      return state;
    },
  };
}

const baseRow: DbRow = {
  id: "post_quarantined",
  type: "app",
  title: "Quarantined post",
  description: null,
  tags: "[\"demo\"]",
  created_at: 1_700_000_000,
  author_id: "user_demo",
  author_handle: "demo",
  author_name: "Demo User",
  author_avatar: null,
  author_followers_count: 0,
  author_runs_count: 0,
  author_remixes_count: 0,
  author_is_featured: 0,
  author_plan: "free",
  author_is_suspended: 0,
  author_shadow_banned: 0,
  capsule_id: null,
  manifest_json: null,
  cover_key: null,
};

const ctx: any = {};

describe("getPostById quarantine visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for quarantined posts when requester is not a moderator", async () => {
    const env = { DB: makeDb(baseRow) } as unknown as Env;

    (verifyAuth as any).mockResolvedValueOnce(null);
    (isModeratorOrAdmin as any).mockReturnValue(false);

    const req = new Request("https://example.com/posts/post_quarantined");
    const res = await getPostById(req, env, ctx, { p1: "post_quarantined" });

    expect(res.status).toBe(404);
  });

  it("allows moderators to fetch quarantined posts", async () => {
    const env = { DB: makeDb(baseRow) } as unknown as Env;

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

    (verifyAuth as any).mockResolvedValueOnce(user);
    (isModeratorOrAdmin as any).mockReturnValue(true);

    const req = new Request("https://example.com/posts/post_quarantined");
    const res = await getPostById(req, env, ctx, { p1: "post_quarantined" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toHaveProperty("post");
    expect(body.post.id).toBe("post_quarantined");
  });
});
