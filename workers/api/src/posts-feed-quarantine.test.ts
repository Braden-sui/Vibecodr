import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "./types";
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
import type { Handler } from "./types";

// Import getPosts via the routes table to avoid exporting internals directly.
// The route pattern for GET /posts is wired to the same handler used by the feed.
import * as indexModule from "./index";

type DbRow = Record<string, any>;

function makeDbForGetPosts(row: DbRow) {
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
          if (query.startsWith("PRAGMA table_info(posts)")) {
            return { results: [{ name: "visibility" }] };
          }
          if (query.includes("FROM posts p") && query.includes("INNER JOIN users u")) {
            // Enforce that the query always filters out quarantined posts.
            expect(query).toMatch(/p\.quarantined IS NULL OR p\.quarantined = 0/);
            return { results: [row] };
          }

          if (query.includes("FROM likes")) {
            return { results: [] };
          }
          if (query.includes("FROM comments")) {
            return { results: [] };
          }
          if (query.includes("FROM runs")) {
            return { results: [] };
          }
          if (query.includes("FROM remixes")) {
            return { results: [] };
          }
          if (query.includes("FROM artifacts")) {
            return { results: [] };
          }

          return { results: [] };
        },
        async first() {
          if (query.startsWith("SELECT 1 FROM likes")) {
            return null;
          }
          if (query.startsWith("SELECT 1 FROM follows")) {
            return null;
          }
          return null;
        },
      };
      return state;
    },
  };
}

const baseRow: DbRow = {
  id: "post_quarantined_feed",
  type: "app",
  title: "Quarantined feed post",
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
};

const ctx: any = {};

function findGetPostsHandler(): Handler {
  const routes = (indexModule as any).routes as Array<{ method: string; pattern: RegExp; handler: Handler }>;
  const route = routes.find((r) => r.method === "GET" && r.pattern.test("/posts"));
  if (!route) {
    throw new Error("GET /posts route not found");
  }
  return route.handler;
}

describe("feed getPosts quarantine visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters quarantined posts for non-moderators", async () => {
    const env = { DB: makeDbForGetPosts(baseRow) } as unknown as Env;
    (verifyAuth as any).mockResolvedValueOnce(null);
    (isModeratorOrAdmin as any).mockReturnValue(false);

    const handler = findGetPostsHandler();
    const req = new Request("https://example.com/posts?mode=latest&limit=10");
    const res = await handler(req, env, ctx, {});

    expect(res.status).toBe(200);
  });

  it("filters quarantined posts for moderators/admins as well", async () => {
    const env = { DB: makeDbForGetPosts(baseRow) } as unknown as Env;

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

    const handler = findGetPostsHandler();
    const req = new Request("https://example.com/posts?mode=latest&limit=10");
    const res = await handler(req, env, ctx, {});

    expect(res.status).toBe(200);
  });
});
