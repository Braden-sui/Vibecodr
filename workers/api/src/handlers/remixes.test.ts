/// <reference types="vitest" />
import { describe, it, expect } from "vitest";
import type { Env } from "../types";
import { getRemixTree } from "./remixes";

type TestEnv = Env & { queries: string[] };

function createEnv(): TestEnv {
  const queries: string[] = [];

  const prepare = (sql: string) => {
    const trimmedSql = sql.trim();
    queries.push(sql);
    if (sql.includes("remixes") && sql.includes("created_at")) {
      throw new Error("remixes.created_at should not be referenced");
    }
    const stmt: any = {
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async all<T>() {
        if (trimmedSql.startsWith("PRAGMA table_info(posts)")) {
          return { results: [{ name: "visibility" }] as any };
        }
        if (sql.includes("FROM remixes WHERE parent_capsule_id")) {
          const parentIds = this.bindArgs as string[];
          const parentId = parentIds[0] ?? "root-cap";
          return {
            results: [
              { parent_capsule_id: parentId, child_capsule_id: "child-1" },
              { parent_capsule_id: parentId, child_capsule_id: "child-2" },
            ] as any,
          };
        }
        if (trimmedSql.startsWith("SELECT p.id as post_id")) {
          const capsuleIds = this.bindArgs as string[];
          return {
            results: capsuleIds.map((id, idx) => ({
              post_id: `post-${idx}`,
              title: `Capsule ${id}`,
              description: `Description ${id}`,
              capsule_id: id,
              created_at: 123 + idx,
              author_id: `author-${idx}`,
              author_handle: `handle-${idx}`,
              profile_display_name: `display-${idx}`,
            })),
          };
        }
        return { results: [] as any[] };
      },
      async first<T>() {
        if (trimmedSql.startsWith("SELECT id FROM capsules WHERE id = ?")) {
          const id = this.bindArgs[0] as string;
          return { id } as any;
        }
        if (trimmedSql.startsWith("SELECT parent_capsule_id FROM remixes WHERE child_capsule_id = ?")) {
          return { parent_capsule_id: null } as any;
        }
        return null;
      },
    };
    return stmt;
  };

  return {
    DB: { prepare } as any,
    R2: {} as any,
    vibecodr_analytics_engine: {} as any,
    ALLOWLIST_HOSTS: "[]",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    CLERK_JWT_ISSUER: "",
    queries,
  } as unknown as TestEnv;
}

describe("getRemixTree", () => {
  it("builds a remix tree without relying on remixes.created_at", async () => {
    const env = createEnv();
    const res = await getRemixTree(
      new Request("https://example.com/capsules/root-cap/remixes"),
      env,
      {} as any,
      { p1: "root-cap" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rootCapsuleId: string;
      nodes: Array<{ capsuleId: string; parentId: string | null }>;
      truncated: boolean;
    };
    expect(body.rootCapsuleId).toBe("root-cap");
    const childCapsules = body.nodes.filter((n) => n.parentId === "root-cap").map((n) => n.capsuleId);
    expect(childCapsules).toContain("child-1");
    expect(childCapsules).toContain("child-2");
    expect(body.truncated).toBe(false);
    expect(env.queries.some((q) => q.includes("remixes.created_at"))).toBe(false);
  });
});
