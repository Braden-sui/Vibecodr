import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "./types";

vi.mock("./auth", () => {
  return {
    verifyAuth: vi.fn(),
    isModeratorOrAdmin: vi.fn(),
    requireUser: (handler: unknown) => handler,
    requireAuth: (handler: unknown) => handler,
    requireAdmin: (handler: unknown) => handler,
  };
});

vi.mock("./contracts", () => {
  const passthrough = {
    parse: (value: unknown) => value,
  } as any;
  return {
    ApiUserProfileResponseSchema: passthrough,
    ApiUserPostsResponseSchema: passthrough,
  };
});

import { getUserPosts } from "./handlers/profiles";
import { verifyAuth } from "./auth";

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
          if (query.includes("FROM posts p") && query.includes("WHERE p.author_id = ?")) {
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
          if (query.startsWith("SELECT id FROM users WHERE handle = ?")) {
            return { id: "user_demo" };
          }
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
  id: "post_quarantined_profile",
  type: "app",
  title: "Quarantined profile post",
  description: null,
  tags: '["demo"]',
  cover_key: null,
  created_at: 1_700_000_000,
  capsule_id: null,
  manifest_json: null,
};

const ctx: any = {};

describe("getUserPosts quarantine visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters quarantined posts from profile timelines", async () => {
    const env = { DB: makeDb(baseRow) } as unknown as Env;

    (verifyAuth as any).mockResolvedValueOnce(null);

    const req = new Request("https://example.com/users/demo/posts?limit=10");
    const res = await getUserPosts(req, env, ctx, { p1: "demo" });

    expect(res.status).toBe(200);
  });
});
