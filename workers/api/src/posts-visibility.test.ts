import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env, Handler } from "./index";
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

import * as indexModule from "./index";
import { getPostById } from "./index";
import { verifyAuth, isModeratorOrAdmin } from "./auth";

type DbRow = Record<string, any>;

const ctx: any = {};

function findGetPostsHandler(): Handler {
  const routes = (indexModule as any).routes as Array<{ method: string; pattern: RegExp; handler: Handler }>;
  const route = routes.find((r) => r.method === "GET" && r.pattern.test("/posts"));
  if (!route) {
    throw new Error("GET /posts route not found");
  }
  return route.handler;
}

function makeDbForFeed(rows: DbRow[]) {
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
          if (query.includes("FROM posts p") && query.includes("INNER JOIN users u")) {
            expect(query).toMatch(/p\.visibility = 'public'/);
            return { results: rows };
          }

          if (query.includes("FROM likes")) return { results: [] };
          if (query.includes("FROM comments")) return { results: [] };
          if (query.includes("FROM runs")) return { results: [] };
          if (query.includes("FROM remixes")) return { results: [] };
          if (query.includes("FROM artifacts")) return { results: [] };

          return { results: [] };
        },
        async first() {
          if (query.startsWith("SELECT 1 FROM likes")) return null;
          if (query.startsWith("SELECT 1 FROM follows")) return null;
          return null;
        },
      };
      return state;
    },
  };
}

function makeDbForPost(row: DbRow) {
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
          if (query.includes("FROM posts p") && query.includes("WHERE p.id = ?")) {
            return { results: [row] };
          }
          return { results: [] };
        },
        async first() {
          if (query.startsWith("SELECT COUNT(*) as count FROM likes")) return { count: 0 };
          if (query.startsWith("SELECT COUNT(*) as count FROM comments")) return { count: 0 };
          if (query.startsWith("SELECT COUNT(*) as count FROM runs")) return { count: 0 };
          if (query.startsWith("SELECT COUNT(*) as count FROM remixes")) return { count: 0 };
          if (query.startsWith("SELECT id FROM artifacts")) return null;
          if (query.startsWith("SELECT 1 FROM likes")) return null;
          if (query.startsWith("SELECT 1 FROM follows")) return null;
          return null;
        },
      };
      return state;
    },
  };
}

const baseFeedRow: DbRow = {
  id: "post_public",
  type: "app",
  title: "Public Post",
  description: null,
  tags: '["demo"]',
  cover_key: null,
  visibility: "public",
  created_at: 1_700_000_000,
  author_id: "user_demo",
  author_handle: "demo",
  author_name: "Demo User",
  author_avatar: null,
  author_bio: null,
  author_followers_count: 0,
  author_runs_count: 0,
  author_remixes_count: 0,
  author_is_featured: 0,
  author_plan: "free",
  author_is_suspended: 0,
  author_shadow_banned: 0,
  profile_display_name: null,
  profile_avatar: null,
  profile_bio: null,
  capsule_id: null,
  manifest_json: null,
};

const basePostRow: DbRow = {
  id: "post_private",
  type: "app",
  title: "Hidden Post",
  description: null,
  tags: '["demo"]',
  cover_key: null,
  visibility: "private",
  created_at: 1_700_000_000,
  author_id: "user_owner",
  author_handle: "owner",
  author_name: "Owner User",
  author_avatar: null,
  author_bio: null,
  author_followers_count: 0,
  author_runs_count: 0,
  author_remixes_count: 0,
  author_is_featured: 0,
  author_plan: "free",
  author_is_suspended: 0,
  author_shadow_banned: 0,
  profile_display_name: null,
  profile_avatar: null,
  profile_bio: null,
  capsule_id: null,
  manifest_json: null,
};

describe("post visibility enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes non-public posts from the feed response", async () => {
    const feedRows = [
      { ...baseFeedRow, id: "post_public", visibility: "public" },
      { ...baseFeedRow, id: "post_unlisted", visibility: "unlisted" },
      { ...baseFeedRow, id: "post_private", visibility: "private" },
    ];
    const env = { DB: makeDbForFeed(feedRows) } as unknown as Env;

    (verifyAuth as any).mockResolvedValueOnce(null);
    (isModeratorOrAdmin as any).mockReturnValue(false);

    const handler = findGetPostsHandler();
    const req = new Request("https://example.com/posts?mode=latest&limit=10");
    const res = await handler(req, env, ctx, {});

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.posts.map((p: any) => p.id)).toEqual(["post_public"]);
  });

  it("returns 404 for non-public posts when viewer is not author or moderator", async () => {
    const env = { DB: makeDbForPost({ ...basePostRow, visibility: "unlisted" }) } as unknown as Env;

    (verifyAuth as any).mockResolvedValueOnce(null);
    (isModeratorOrAdmin as any).mockReturnValue(false);

    const req = new Request("https://example.com/posts/post_private");
    const res = await getPostById(req, env, ctx, { p1: "post_private" });

    expect(res.status).toBe(404);
  });

  it("allows the author to fetch their own non-public post", async () => {
    const env = { DB: makeDbForPost({ ...basePostRow, visibility: "private" }) } as unknown as Env;

    const user: AuthenticatedUser = {
      userId: "user_owner",
      sessionId: "sess-1",
      claims: {
        iss: "https://clerk.example",
        sub: "user_owner",
        exp: Math.floor(Date.now() / 1000) + 3600,
      } as any,
    };

    (verifyAuth as any).mockResolvedValueOnce(user);
    (isModeratorOrAdmin as any).mockReturnValue(false);

    const req = new Request("https://example.com/posts/post_private");
    const res = await getPostById(req, env, ctx, { p1: "post_private" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.post.id).toBe("post_private");
  });
});
