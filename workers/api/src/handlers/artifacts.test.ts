/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../types";
import { createArtifactUpload, uploadArtifactSources, completeArtifact, getArtifactManifest, getArtifactBundle } from "./artifacts";
import { getUserRunQuotaState, Plan } from "../storage/quotas";

vi.mock("../auth", () => {
  return {
    requireAuth:
      (handler: any) =>
      (req: any, env: Env, ctx: any, params: any) =>
        handler(req, env, ctx, params, {
          userId: "u1",
          sessionId: "sess1",
          claims: {} as any,
        }),
  };
});

vi.mock("../storage/quotas", async () => {
  const actual = await vi.importActual<typeof import("../storage/quotas")>("../storage/quotas");
  return {
    ...actual,
    getUserRunQuotaState: vi.fn(),
  };
});

const getUserRunQuotaStateMock = vi.mocked(getUserRunQuotaState);

const createEnv = (): Env => {
  const prepare = vi.fn((sql: string) => {
    const stmt: any = {
      sql,
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async all() {
        if (sql.includes("SELECT plan FROM users")) {
          return { results: [{ plan: "free" }] };
        }
        if (sql.includes("SELECT SUM(size) as total")) {
          return { results: [{ total: 0 }] };
        }
        if (sql.includes("FROM capsules") && sql.includes("WHERE id = ?")) {
          const capsuleId = this.bindArgs[0];
          if (capsuleId === "missing-capsule") {
            return { results: [] };
          }
          if (capsuleId === "foreign-capsule") {
            return {
              results: [
                {
                  id: "foreign-capsule",
                  owner_id: "u2",
                },
              ],
            };
          }
          return {
            results: [
              {
                id: capsuleId,
                owner_id: "u1",
              },
            ],
          };
        }
        if (sql.includes("FROM artifacts") && sql.includes("WHERE id = ?")) {
          const artifactId = this.bindArgs[0];
          if (artifactId === "missing-artifact") {
            return { results: [] };
          }
          if (artifactId === "foreign-artifact") {
            return {
              results: [
                {
                  id: "foreign-artifact",
                  owner_id: "u2",
                  type: "react-jsx",
                  runtime_version: "v0.1.0",
                  status: "active",
                  policy_status: "active",
                  visibility: "public",
                },
              ],
            };
          }
          if (artifactId === "kv-artifact") {
            return {
              results: [
                {
                  id: "kv-artifact",
                  owner_id: "u1",
                  type: "react-jsx",
                  runtime_version: "v0.1.0",
                  status: "active",
                  policy_status: "active",
                  visibility: "public",
                },
              ],
            };
          }
          if (artifactId === "db-artifact") {
            return {
              results: [
                {
                  id: "db-artifact",
                  owner_id: "u1",
                  type: "react-jsx",
                  runtime_version: "v0.1.0",
                  status: "active",
                  policy_status: "active",
                  visibility: "public",
                },
              ],
            };
          }
          return {
            results: [
              {
                id: "a1",
                owner_id: "u1",
                type: "react-jsx",
                runtime_version: "v0.1.0",
                status: "active",
                policy_status: "active",
                visibility: "public",
              },
            ],
          };
        }
        if (sql.includes("FROM artifact_manifests") && sql.includes("WHERE artifact_id = ?")) {
          const artifactId = this.bindArgs[0];
          if (artifactId === "kv-artifact") {
            return {
              results: [
                {
                  manifest_json: runtimeManifestFor("kv-artifact", "db"),
                  version: 1,
                  runtime_version: "v0.1.0",
                },
              ],
            };
          }
          if (artifactId === "db-artifact") {
            return {
              results: [
                {
                  manifest_json: runtimeManifestFor("db-artifact", "db"),
                  version: 2,
                  runtime_version: "v0.1.0",
                },
              ],
            };
          }
          return {
            results: [
              {
                manifest_json: runtimeManifestFor(typeof artifactId === "string" ? artifactId : "a1"),
                version: 1,
                runtime_version: "v0.1.0",
              },
            ],
          };
        }
        return { results: [] };
      },
      async run() {
        return { success: true };
      },
      async first() {
        const res = await this.all();
        // Normalize shape similar to D1 first()
        return (res as any)?.results?.[0] ?? null;
      },
    };
    return stmt;
  });

  const kvStore = new Map<string, string>();
  const kvPut = vi.fn(async (key: string, value: string) => {
    kvStore.set(key, value);
  });
  const kvGet = vi.fn(async (key: string) => {
    return kvStore.get(key) ?? null;
  });
  const runtimeManifestFor = (id: string, source?: string) =>
    JSON.stringify({
      artifactId: id,
      type: "react-jsx",
      runtime: {
        version: "v0.1.0",
        assets: {
          bridge: { path: "/runtime-assets/v0.1.0/bridge.js" },
          guard: { path: "/runtime-assets/v0.1.0/guard.js" },
          runtimeScript: { path: "/runtime-assets/v0.1.0/react-runtime.js" },
        },
      },
      bundle: {
        r2Key: `artifacts/${id}/bundle.js`,
        sizeBytes: 1024,
        digest: `digest-${id}`,
      },
      source,
    });

  const r2Objects = new Map<
    string,
    {
      body: any;
      httpMetadata?: { contentType?: string };
    }
  >();

  const doFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify({ ok: true, queued: true }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  });

  const artifactCompilerNs: any = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => ({ fetch: doFetch })),
    __doFetch: doFetch,
  };

  return {
    DB: { prepare } as any,
    R2: {
      put: vi.fn(async (key: string, body: any, options?: any) => {
        r2Objects.set(key, { body, httpMetadata: options?.httpMetadata });
      }),
      get: vi.fn(async (key: string) => {
        const entry = r2Objects.get(key);
        if (!entry) return null;
        return {
          body: entry.body,
          httpMetadata: entry.httpMetadata,
        };
      }),
    } as any,
    RUNTIME_MANIFEST_KV: {
      put: kvPut,
      get: kvGet,
    } as any,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "https://clerk.example",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: artifactCompilerNs,
    RATE_LIMIT_SHARD: {} as any,
    vibecodr_analytics_engine: {} as any,
    RUNTIME_ARTIFACTS_ENABLED: "true",
  };
};

function req(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("https://api.example" + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("artifacts handlers", () => {
  let env: Env;

  beforeEach(() => {
    env = createEnv();
    vi.clearAllMocks();
    getUserRunQuotaStateMock.mockReset();
    getUserRunQuotaStateMock.mockResolvedValue({
      plan: Plan.FREE,
      runsThisMonth: 0,
      result: { allowed: true },
    });
  });

  it("rejects missing type on createArtifactUpload", async () => {
    const res = await createArtifactUpload(req("POST", "/artifacts", { capsuleId: "c1" }), env, {} as any, {} as any);
    expect(res.status).toBe(400);
  });

  it("rejects invalid type on createArtifactUpload", async () => {
    const res = await createArtifactUpload(
      req("POST", "/artifacts", { type: "invalid-type", capsuleId: "c1" }),
      env,
      {} as any,
      {} as any
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Invalid artifact type");
  });

  it("creates upload session with artifactId and upload info", async () => {
    const res = await createArtifactUpload(
      req("POST", "/artifacts", { type: "react-jsx", capsuleId: "c1", estimatedSizeBytes: 1024 }),
      env,
      {} as any,
      {} as any
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(typeof json.artifactId).toBe("string");
    expect(json.upload).toBeDefined();
    expect(json.upload.method).toBe("PUT");
    expect(json.upload.url).toContain("/api/artifacts/");
  });

  it("404s when capsule is missing", async () => {
    const res = await createArtifactUpload(
      req("POST", "/artifacts", { type: "react-jsx", capsuleId: "missing-capsule" }),
      env,
      {} as any,
      {} as any
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Capsule not found");
  });

  it("rejects when capsule belongs to another user", async () => {
    const res = await createArtifactUpload(
      req("POST", "/artifacts", { type: "react-jsx", capsuleId: "foreign-capsule" }),
      env,
      {} as any,
      {} as any
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Forbidden");
  });

  it("uploads sources to R2 in uploadArtifactSources", async () => {
    const body = new ArrayBuffer(512);
    const res = await uploadArtifactSources(
      new Request("https://api.example/artifacts/a1/sources", {
        method: "PUT",
        body,
        headers: { "content-type": "application/octet-stream" },
      }),
      env,
      {} as any,
      { p1: "a1" } as any
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.artifactId).toBe("a1");
    expect(json.size).toBe(512);

    const put = (env.R2 as any).put as any;
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe("artifacts/a1/v1/sources.tar");
  });

  it("rejects upload for unknown artifact id", async () => {
    const body = new ArrayBuffer(128);
    const res = await uploadArtifactSources(
      new Request("https://api.example/artifacts/missing-artifact/sources", {
        method: "PUT",
        body,
        headers: { "content-type": "application/octet-stream" },
      }),
      env,
      {} as any,
      { p1: "missing-artifact" } as any
    );

    expect(res.status).toBe(404);
    const json = (await res.json()) as any;
    expect(json.error).toBe("Artifact not found");
    const put = (env.R2 as any).put as any;
    expect(put).not.toHaveBeenCalled();
  });

  it("queues artifact compile via ArtifactCompiler DO for owned artifact", async () => {
    const req = new Request("https://api.example/artifacts/a1/complete", {
      method: "PUT",
      headers: { "content-type": "application/json" },
    });

    const res = await completeArtifact(req, env, {} as any, { p1: "a1" } as any);
    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.artifactId).toBe("a1");

    const ns = env.ARTIFACT_COMPILER_DURABLE as any;
    expect(ns.idFromName).toHaveBeenCalledWith("a1");
    expect(ns.get).toHaveBeenCalledTimes(1);
    expect(ns.__doFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects compile when run quota is exceeded", async () => {
    getUserRunQuotaStateMock.mockResolvedValueOnce({
      plan: Plan.FREE,
      runsThisMonth: 6000,
      result: {
        allowed: false,
        reason: "Monthly run quota exceeded (6000/5000).",
        limits: { maxRuns: 5000 } as any,
        usage: { runs: 6000 } as any,
      },
    });

    const req = new Request("https://api.example/artifacts/a1/complete", {
      method: "PUT",
      headers: { "content-type": "application/json" },
    });

    const res = await completeArtifact(req, env, {} as any, { p1: "a1" } as any);
    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Run quota exceeded");
    expect(body.reason).toContain("Monthly run quota exceeded");

    const ns = env.ARTIFACT_COMPILER_DURABLE as any;
    expect(ns.idFromName).not.toHaveBeenCalled();
    expect(ns.__doFetch).not.toHaveBeenCalled();
  });

  it("rejects compile for unknown artifact id", async () => {
    const req = new Request("https://api.example/artifacts/missing-artifact/complete", {
      method: "PUT",
      headers: { "content-type": "application/json" },
    });

    const res = await completeArtifact(req, env, {} as any, { p1: "missing-artifact" } as any);
    expect(res.status).toBe(404);
    const json = (await res.json()) as any;
    expect(json.error).toBe("Artifact not found");

    const ns = env.ARTIFACT_COMPILER_DURABLE as any;
    expect(ns.idFromName).not.toHaveBeenCalled();
    expect(ns.__doFetch).not.toHaveBeenCalled();
  });

  it("rejects compile when artifact is owned by a different user", async () => {
    const req = new Request("https://api.example/artifacts/foreign-artifact/complete", {
      method: "PUT",
      headers: { "content-type": "application/json" },
    });

    const res = await completeArtifact(req, env, {} as any, { p1: "foreign-artifact" } as any);
    expect(res.status).toBe(403);
    const json = (await res.json()) as any;
    expect(json.error).toBe("Forbidden");

    const ns = env.ARTIFACT_COMPILER_DURABLE as any;
    expect(ns.idFromName).not.toHaveBeenCalled();
    expect(ns.__doFetch).not.toHaveBeenCalled();
  });

  it("rejects upload when artifact is owned by a different user", async () => {
    const body = new ArrayBuffer(256);
    const res = await uploadArtifactSources(
      new Request("https://api.example/artifacts/foreign-artifact/sources", {
        method: "PUT",
        body,
        headers: { "content-type": "application/octet-stream" },
      }),
      env,
      {} as any,
      { p1: "foreign-artifact" } as any
    );

    expect(res.status).toBe(403);
    const json = (await res.json()) as any;
    expect(json.error).toBe("Forbidden");
    const put = (env.R2 as any).put as any;
    expect(put).not.toHaveBeenCalled();
  });

  it("returns runtime manifest for active artifact", async () => {
    const req = new Request("https://api.example/artifacts/a1/manifest", {
      method: "GET",
    });

    const res = await getArtifactManifest(req, env, {} as any, { p1: "a1" } as any);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.artifactId).toBe("a1");
    expect(body.type).toBe("react-jsx");
    expect(body.runtimeVersion).toBe("v0.1.0");
    expect(body.manifest).toBeDefined();
    expect(body.manifest.artifactId).toBe("a1");
  });

  it("prefers KV manifest when available", async () => {
    const kvPut = (env.RUNTIME_MANIFEST_KV as any).put as ReturnType<typeof vi.fn>;
    const kvManifest = {
      artifactId: "kv-artifact",
      source: "kv",
      type: "react-jsx",
    };
    await kvPut("artifacts/kv-artifact/v1/runtime-manifest.json", JSON.stringify(kvManifest));

    const req = new Request("https://api.example/artifacts/kv-artifact/manifest", {
      method: "GET",
    });

    const res = await getArtifactManifest(req, env, {} as any, { p1: "kv-artifact" } as any);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.artifactId).toBe("kv-artifact");
    expect(body.manifest).toBeDefined();
    expect(body.manifest.source).toBe("kv");
  });

  it("falls back to D1 manifest when KV is missing", async () => {
    const req = new Request("https://api.example/artifacts/db-artifact/manifest", {
      method: "GET",
    });

    const res = await getArtifactManifest(req, env, {} as any, { p1: "db-artifact" } as any);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.artifactId).toBe("db-artifact");
    expect(body.manifest).toBeDefined();
    expect(body.manifest.source).toBe("db");
  });

  it("serves artifact bundles with strict offline CSP by default", async () => {
    await (env.R2 as any).put("artifacts/a1/bundle.js", "console.log('ok')", {
      httpMetadata: { contentType: "application/javascript" },
    });

    const res = await getArtifactBundle(
      new Request("https://api.example/artifacts/a1/bundle"),
      env,
      {} as any,
      { p1: "a1" } as any
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Runtime-Artifact")).toBe("a1");
    expect(res.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
    expect(res.headers.get("Content-Type")).toBe("application/javascript");
  });

  it("allows https connect-src when bundle mode is relaxed", async () => {
    (env as any).CAPSULE_BUNDLE_NETWORK_MODE = "allow-https";
    await (env.R2 as any).put("artifacts/a1/bundle.js", "console.log('ok')", {
      httpMetadata: { contentType: "application/javascript" },
    });

    const res = await getArtifactBundle(
      new Request("https://api.example/artifacts/a1/bundle"),
      env,
      {} as any,
      { p1: "a1" } as any
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("connect-src 'self' https:");
  });
});
