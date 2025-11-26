/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../types";
import { compileDraftArtifact, getCapsuleFilesSummary, updateCapsuleManifest, publishCapsuleDraft } from "./studio";
import { Plan } from "../storage/quotas";

const getUserRunQuotaStateMock = vi.fn();

vi.mock("../storage/quotas", async () => {
  const actual = await vi.importActual<typeof import("../storage/quotas")>("../storage/quotas");
  return {
    ...actual,
    getUserRunQuotaState: (...args: Parameters<typeof getUserRunQuotaStateMock>) =>
      getUserRunQuotaStateMock(...args),
  };
});

vi.mock("../auth", () => ({
  requireAuth:
    (handler: any) =>
    (req: Request, env: Env, ctx: any, params: Record<string, string>) =>
      handler(req, env, ctx, params, {
        userId: "u1",
        sessionId: "sess1",
        claims: {} as any,
      }),
}));

const bundleInlineJsMock = vi.fn(async () => ({
  content: new Uint8Array([1, 2, 3]),
}));

vi.mock("./inlineBundle", () => ({
  bundleInlineJs: (...args: Parameters<typeof bundleInlineJsMock>) => bundleInlineJsMock(...args),
}));

type TestEnv = Env & {
  __capsule: { id: string; owner_id: string; manifest_json: string; hash: string };
  __artifacts: any[];
  __artifactManifests: any[];
  __r2Objects: Map<string, { body: ArrayBuffer; contentType: string }>;
  __posts: any[];
};

function createEnv(manifest: any): TestEnv {
  const manifestJson = JSON.stringify(manifest);
  const capsule = {
    id: "cap-1",
    owner_id: "u1",
    manifest_json: manifestJson,
    hash: "hash-123",
  };
  const artifacts: any[] = [];
  const artifactManifests: any[] = [];
  const r2Objects = new Map<string, { body: ArrayBuffer; contentType: string }>();
  const posts: any[] = [];

  const DB = {
    prepare: vi.fn((sql: string) => {
      const stmt: any = {
        bindArgs: [] as any[],
        bind(...args: any[]) {
          this.bindArgs = args;
          return this;
        },
        async all() {
          if (sql.includes("FROM capsules")) {
            return { results: [capsule] };
          }
          if (sql.includes("SELECT size FROM assets")) {
            return { results: [] };
          }
          if (sql.includes("SELECT size FROM assets")) {
            return { results: [] };
          }
          if (sql.includes("SELECT id, owner_id, manifest_json, hash FROM capsules")) {
            return { results: [capsule] };
          }
          return { results: [] };
        },
        async first() {
          return undefined;
        },
        async run() {
          if (sql.startsWith("INSERT INTO artifacts")) {
            const [id, ownerId, capsuleId, type, runtimeVersion, bundleDigest, status, visibility] = this.bindArgs;
            artifacts.push({ id, ownerId, capsuleId, type, runtimeVersion, bundleDigest, status, visibility });
          }
          if (sql.startsWith("INSERT INTO artifact_manifests")) {
            const [id, artifactId, version, manifestJson, sizeBytes, runtimeVersion] = this.bindArgs;
            artifactManifests.push({ id, artifactId, version, manifestJson, sizeBytes, runtimeVersion });
          }
          if (sql.startsWith("UPDATE capsules SET manifest_json")) {
            capsule.manifest_json = this.bindArgs[0];
          }
          if (sql.startsWith("INSERT INTO posts")) {
            const [id, authorId, type, capsuleId, title] = this.bindArgs;
            posts.push({ id, authorId, type, capsuleId, title });
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    }),
  } as any;

  const R2 = {
    put: vi.fn((key: string, body: ArrayBuffer | string, options?: any) => {
      const buffer = typeof body === "string" ? new TextEncoder().encode(body).buffer : body;
      r2Objects.set(key, { body: buffer, contentType: options?.httpMetadata?.contentType || "application/octet-stream" });
    }),
    get: vi.fn(async (key: string) => {
      const entry = r2Objects.get(key);
      if (!entry) return null;
      return {
        arrayBuffer: async () => entry.body,
        body: entry.body,
        httpMetadata: { contentType: entry.contentType },
      } as any;
    }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => {
      const objects: Array<{ key: string; size: number; customMetadata?: Record<string, string> }> = [];
      for (const key of r2Objects.keys()) {
        if (key.startsWith(prefix)) {
          const val = r2Objects.get(key)!;
          objects.push({
            key,
            size: val.body.byteLength,
            customMetadata: {},
          });
        }
      }
      return { objects };
    }),
  } as any;

  return {
    DB,
    R2,
    RUNTIME_MANIFEST_KV: { put: vi.fn() } as any,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    vibecodr_analytics_engine: {} as any,
    __capsule: capsule,
    __artifacts: artifacts,
    __artifactManifests: artifactManifests,
    __r2Objects: r2Objects,
    __posts: posts,
  } as any;
}

describe("studio endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserRunQuotaStateMock.mockResolvedValue({
      plan: Plan.PRO,
      runsThisMonth: 0,
      result: { allowed: true, limits: { maxRuns: 250000 } as any, usage: { runs: 0 } as any },
    });
  });

  it("compiles a draft html artifact and writes runtime manifest", async () => {
    const env = createEnv({ version: "1.0", runner: "client-static", entry: "index.html" });
    env.__r2Objects.set("capsules/hash-123/index.html", { body: new TextEncoder().encode("<html></html>").buffer, contentType: "text/html" });

    const res = await compileDraftArtifact(
      new Request("https://worker.test/capsules/cap-1/compile-draft", { method: "POST" }),
      env,
      {} as any,
      { p1: "cap-1" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifactId: string; bundleKey: string };
    expect(body.artifactId).toBeTruthy();
    expect(env.__artifacts[0]?.status).toBe("draft");
    expect(env.__artifactManifests[0]?.artifactId).toBe(body.artifactId);
    expect(env.R2.put).toHaveBeenCalledWith(
      `artifacts/${body.artifactId}/v1/runtime-manifest.json`,
      expect.any(String),
      expect.anything()
    );
  });

  it("returns file summary for owned capsule", async () => {
    const env = createEnv({ version: "1.0", runner: "client-static", entry: "index.html" });
    env.__r2Objects.set("capsules/hash-123/index.html", { body: new TextEncoder().encode("<html></html>").buffer, contentType: "text/html" });
    env.__r2Objects.set("capsules/hash-123/manifest.json", { body: new TextEncoder().encode(env.__capsule.manifest_json).buffer, contentType: "application/json" });

    const res = await getCapsuleFilesSummary(
      new Request("https://worker.test/capsules/cap-1/files-summary", { method: "GET" }),
      env,
      {} as any,
      { p1: "cap-1" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { capsuleId: string; files: Array<{ path: string }> };
    expect(body.capsuleId).toBe("cap-1");
    expect(body.files.some((f) => f.path === "index.html")).toBe(true);
  });

  it("updates manifest with validation", async () => {
    const env = createEnv({ version: "1.0", runner: "client-static", entry: "index.html" });
    const nextManifest = { version: "1.0", runner: "client-static", entry: "index.html", params: [] };
    env.__r2Objects.set("capsules/hash-123/index.html", { body: new TextEncoder().encode("<html></html>").buffer, contentType: "text/html" });
    env.__r2Objects.set("capsules/hash-123/manifest.json", { body: new TextEncoder().encode(env.__capsule.manifest_json).buffer, contentType: "application/json" });

    const res = await updateCapsuleManifest(
      new Request("https://worker.test/capsules/cap-1/manifest", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextManifest),
      }),
      env,
      {} as any,
      { p1: "cap-1" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { entryCandidates: string[] };
    expect(JSON.parse(env.__capsule.manifest_json).params).toEqual([]);
    expect(body.entryCandidates).toContain("index.html");
    const storedManifest = env.__r2Objects.get("capsules/hash-123/manifest.json");
    expect(storedManifest).toBeDefined();
    expect(new TextDecoder().decode(storedManifest!.body)).toContain("\"params\":[]");
  });

  it("rejects manifest updates when entry file is missing", async () => {
    const env = createEnv({ version: "1.0", runner: "client-static", entry: "missing.html" });
    const nextManifest = { version: "1.0", runner: "client-static", entry: "missing.html", params: [] };

    const res = await updateCapsuleManifest(
      new Request("https://worker.test/capsules/cap-1/manifest", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextManifest),
      }),
      env,
      {} as any,
      { p1: "cap-1" }
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { entry?: string };
    expect(body.entry).toBe("missing.html");
  });

  it("publishes a capsule into posts", async () => {
    const env = createEnv({ version: "1.0", runner: "client-static", entry: "index.html", title: "My App" });
    env.__r2Objects.set("capsules/hash-123/index.html", { body: new TextEncoder().encode("<html></html>").buffer, contentType: "text/html" });
    env.__r2Objects.set("capsules/hash-123/manifest.json", { body: new TextEncoder().encode(JSON.stringify({ version: "1.0", runner: "client-static", entry: "index.html" })).buffer, contentType: "application/json" });

    const res = await publishCapsuleDraft(
      new Request("https://worker.test/capsules/cap-1/publish", { method: "POST" }),
      env,
      {} as any,
      { p1: "cap-1" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { postId?: string; artifactId?: string };
    expect(body.postId).toBeTruthy();
    expect(body.artifactId).toBeTruthy();
    expect(env.__posts.length).toBe(1);
    expect(env.__posts[0].title).toBe("My App");
    expect(env.__artifacts.length).toBe(1);
  });
});
