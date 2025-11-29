/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "./types";
import { getPostById } from "./index";
import { getCapsuleKey } from "./storage/r2";
import { getLatestArtifactsWithCache } from "./feed-artifacts";

vi.mock("./auth", () => ({
  verifyAuth: vi.fn(async () => null),
  isModeratorOrAdmin: vi.fn(() => false),
  requireAdmin:
    (handler: any) =>
    (req: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>) =>
      handler(req, env, ctx, params, {
        userId: "admin",
        sessionId: "sess",
        claims: {} as any,
      }),
  requireUser:
    (handler: any) =>
    (req: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>, userId: string) =>
      handler(req, env, ctx, params, userId),
  requireAuth:
    (handler: any) =>
    (req: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>) =>
      handler(req, env, ctx, params, {
        userId: "viewer",
        sessionId: "sess",
        claims: {} as any,
      }),
}));

let latestArtifactReturn: Map<string, { artifactId: string; createdAt: number }> = new Map();
const getLatestArtifactsWithCacheMock = vi.fn(async (_env: any, _capsuleIds: string[]) => latestArtifactReturn);

vi.mock("./feed-artifacts", () => ({
  getLatestArtifactsWithCache: (env: any, capsuleIds: string[]) =>
    getLatestArtifactsWithCacheMock(env, capsuleIds),
}));

type DbRow = Record<string, unknown>;

const baseCapsule = {
  version: "1.0",
  runner: "client-static",
  entry: "index.html",
};

function createEnv(runtimeFlag: string): Env & { __rows?: DbRow[] } {
  const postRow: DbRow = {
    id: "p1",
    type: "app",
    title: "hello",
    description: "desc",
    tags: '["tag"]',
    cover_key: null,
    visibility: "public",
    created_at: 1,
    author_id: "u1",
    author_handle: "user1",
    author_name: "User One",
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
    capsule_id: "c1",
    capsule_hash: "hash-123",
    manifest_json: JSON.stringify(baseCapsule),
  };

  const counts = { count: 0 };

  const prepare = vi.fn((sql: string) => {
    const stmt: any = {
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async all() {
        if (sql.includes("FROM posts")) {
          return { results: [postRow] };
        }
        if (sql.includes("FROM likes")) {
          return { results: [counts] };
        }
        if (sql.includes("FROM comments")) {
          return { results: [counts] };
        }
        if (sql.includes("FROM runs")) {
          return { results: [counts] };
        }
        if (sql.includes("FROM remixes")) {
          return { results: [counts] };
        }
        return { results: [] };
      },
      async first() {
        const res = await this.all();
        return (res as any).results?.[0] ?? null;
      },
    };
    return stmt;
  });

  const env: Env = {
    DB: { prepare } as any,
    R2: {} as any,
    RUNTIME_MANIFEST_KV: undefined,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "https://example",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    RATE_LIMIT_SHARD: {} as any,
    vibecodr_analytics_engine: {} as any,
    RUNTIME_ARTIFACTS_ENABLED: runtimeFlag,
  };

  (env as any).__rows = [postRow];
  return env as Env & { __rows?: DbRow[] };
}

describe("getPostById runtime artifact flag", () => {
  beforeEach(() => {
    latestArtifactReturn = new Map();
    vi.clearAllMocks();
  });

  it("omits artifactId and returns capsule bundle key when runtime artifacts are disabled", async () => {
    const env = createEnv("false");
    const res = await getPostById(new Request("https://api.example/posts/p1"), env, {} as any, { p1: "p1" });
    const body = (await res.json()) as any;
    if (res.status !== 200) {
      // Aid debugging by surfacing failure payloads in test output
      // eslint-disable-next-line no-console
      console.error("getPostById(runtime off) body", body);
    }
    expect(res.status).toBe(200);
    const capsule = body.post?.capsule;
    expect(capsule?.artifactId).toBeUndefined();
    expect(capsule?.bundleKey).toBe(getCapsuleKey("hash-123", "index.html"));
    expect(capsule?.contentHash).toBe("hash-123");
    expect(getLatestArtifactsWithCacheMock).not.toHaveBeenCalled();
  });

  it("attaches artifactId when runtime artifacts are enabled", async () => {
    const env = createEnv("true");
    latestArtifactReturn = new Map([["c1", { artifactId: "a1", createdAt: 1 }]]);
    const res = await getPostById(new Request("https://api.example/posts/p1"), env, {} as any, { p1: "p1" });
    const body = (await res.json()) as any;
    if (res.status !== 200) {
      // eslint-disable-next-line no-console
      console.error("getPostById(runtime on) body", body);
    }
    expect(res.status).toBe(200);
    const capsule = body.post?.capsule;
    expect(capsule?.artifactId).toBe("a1");
    expect(capsule?.bundleKey).toBeUndefined();
    expect(getLatestArtifactsWithCacheMock).toHaveBeenCalledOnce();
  });
});
