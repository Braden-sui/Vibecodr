import { describe, it, expect, beforeEach } from "vitest";
import { getRemixTree } from "./remixes";
import type { Env } from "../types";
import { resetPostsVisibilityCache } from "../lib/postsVisibility";

type Edge = { parent: string; child: string; createdAt?: number };
type RemixFixture = {
  capsules: Set<string>;
  parents: Map<string, string>;
  edges: Edge[];
  posts: Array<{
    post_id: string;
    capsule_id: string;
    title: string;
    description?: string | null;
    author_id: string;
    author_handle: string;
    author_name?: string | null;
    profile_display_name?: string | null;
    created_at: number;
  }>;
  hasVisibility?: boolean;
};

const ctx: any = {};

function makeDb(data: RemixFixture) {
  return {
    prepare(query: string) {
      const state = {
        query,
        args: [] as any[],
        bind(...args: any[]) {
          state.args = args;
          return state;
        },
        async first() {
          if (query.startsWith("SELECT id FROM capsules")) {
            const id = String(state.args[0]);
            return data.capsules.has(id) ? { id } : null;
          }
          if (query.startsWith("SELECT parent_capsule_id FROM remixes WHERE child_capsule_id = ?")) {
            const child = String(state.args[0]);
            const parent = data.parents.get(child);
            return parent ? { parent_capsule_id: parent } : null;
          }
          return null;
        },
        async all() {
          if (query.startsWith("PRAGMA table_info(posts)")) {
            return { results: data.hasVisibility === false ? [] : [{ name: "visibility" }] };
          }
          if (query.startsWith("SELECT parent_capsule_id, child_capsule_id")) {
            const parentIds = (state.args || []).map(String);
            const results = data.edges
              .filter((edge) => parentIds.includes(edge.parent))
              .map((edge) => ({
                parent_capsule_id: edge.parent,
                child_capsule_id: edge.child,
                created_at: edge.createdAt ?? null,
              }));
            return { results };
          }
          if (query.includes("FROM posts p") && query.includes("capsule_id IN")) {
            const ids = (state.args || []).map(String);
            const results = data.posts
              .filter((post) => ids.includes(String(post.capsule_id)))
              .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
            return { results };
          }
          return { results: [] };
        },
      };
      return state;
    },
  };
}

const baseFixture: RemixFixture = {
  capsules: new Set(["root", "childA", "childB"]),
  parents: new Map([
    ["childA", "root"],
    ["childB", "childA"],
  ]),
  edges: [
    { parent: "root", child: "childA", createdAt: 10 },
    { parent: "childA", child: "childB", createdAt: 20 },
  ],
  posts: [
    {
      post_id: "post-root",
      capsule_id: "root",
      title: "Bouncing Ball",
      description: "Base vibe",
      author_id: "creator",
      author_handle: "creator",
      author_name: "Creator",
      created_at: 1,
    },
    {
      post_id: "post-childA-old",
      capsule_id: "childA",
      title: "Old Neon",
      description: "old version",
      author_id: "maria",
      author_handle: "maria",
      author_name: "Maria",
      created_at: 5,
    },
    {
      post_id: "post-childA-new",
      capsule_id: "childA",
      title: "Neon Ball",
      description: "glow effect",
      author_id: "maria",
      author_handle: "maria",
      author_name: "Maria",
      created_at: 15,
    },
    {
      post_id: "post-childB",
      capsule_id: "childB",
      title: "Disco Ball",
      description: "music sync",
      author_id: "jake",
      author_handle: "jake",
      author_name: "Jake",
      created_at: 25,
    },
  ],
};

describe("getRemixTree", () => {
  beforeEach(() => {
    resetPostsVisibilityCache();
  });

  it("returns lineage with root, parent, and requested remix details", async () => {
    const env = { DB: makeDb(baseFixture) } as unknown as Env;
    const res = await getRemixTree(
      new Request("https://example.com/capsules/childB/remixes"),
      env,
      ctx,
      { p1: "childB" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.rootCapsuleId).toBe("root");
    expect(body.directParentId).toBe("childA");
    const parentNode = body.nodes.find((node: any) => node.capsuleId === "childA");
    expect(parentNode.remixCount).toBe(1);
    expect(parentNode.title).toBe("Neon Ball"); // newest post selected
    const childNode = body.nodes.find((node: any) => node.capsuleId === "childB");
    expect(childNode.parentId).toBe("childA");
    expect(childNode.isRequested).toBe(true);
    expect(childNode.remixCount).toBe(0);
    expect(childNode.title).toBe("Disco Ball");
    expect(body.truncated).toBeFalsy();
  });

  it("returns 404 when capsule is missing", async () => {
    const env = { DB: makeDb({ ...baseFixture, capsules: new Set() }) } as unknown as Env;
    const res = await getRemixTree(
      new Request("https://example.com/capsules/missing/remixes"),
      env,
      ctx,
      { p1: "missing" }
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("E-VIBECODR-0903");
  });

  it("fails fast on ancestry cycles", async () => {
    const env = {
      DB: makeDb({
        ...baseFixture,
        capsules: new Set(["loopA", "loopB"]),
        parents: new Map([
          ["loopA", "loopB"],
          ["loopB", "loopA"],
        ]),
        edges: [],
        posts: [],
      }),
    } as unknown as Env;

    const res = await getRemixTree(
      new Request("https://example.com/capsules/loopA/remixes"),
      env,
      ctx,
      { p1: "loopA" }
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("E-VIBECODR-0902");
  });
});
