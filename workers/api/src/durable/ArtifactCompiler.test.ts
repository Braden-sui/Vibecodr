import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArtifactCompiler } from "./ArtifactCompiler";

vi.mock("../runtime/compileReactArtifact", () => {
  return {
    compileReactArtifact: vi.fn(async ({ code }) => ({
      ok: true,
      code: `compiled:${code}`,
      warnings: ["react-warning"],
    })),
  };
});

vi.mock("../runtime/compileHtmlArtifact", () => {
  return {
    compileHtmlArtifact: vi.fn((input: { html: string }) => ({
      ok: true,
      html: `sanitized:${input.html}`,
      warnings: ["html-warning"],
    })),
  };
});

const r2Mocks = vi.hoisted(() => ({
  listCapsuleFiles: vi.fn(),
  downloadCapsuleFile: vi.fn(),
}));

vi.mock("../storage/r2", async () => {
  const actual = await vi.importActual<typeof import("../storage/r2")>("../storage/r2");
  return {
    ...actual,
    listCapsuleFiles: r2Mocks.listCapsuleFiles,
    downloadCapsuleFile: r2Mocks.downloadCapsuleFile,
  };
});

function createState() {
  const storage = {
    put: vi.fn().mockResolvedValue(undefined),
  };
  const state = { storage } as unknown as DurableObjectState;
  return { state, storage };
}

function createEnv() {
  const vibecodr_analytics_engine = {
    writeDataPoint: vi.fn(),
  };

  const artifactRow = {
    id: "artifact-1",
    capsule_id: "capsule-1",
    type: "react-jsx",
    runtime_version: null,
    bundle_digest: "pending",
    status: "draft",
    policy_status: "active",
    visibility: "private",
    capsule_manifest_json: JSON.stringify({
      version: "1.0",
      runner: "client-static",
      entry: "index.tsx",
    }),
    capsule_hash: "hash-123",
  };

  const dbState: Record<string, any> = {
    artifact: artifactRow,
    manifestVersions: [],
    updated: null as any,
  };

  const prepare = vi.fn((sql: string) => {
    const stmt: any = {
      sql,
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async first() {
        if (sql.includes("FROM artifacts")) {
          const id = this.bindArgs[0];
          if (id === artifactRow.id) return artifactRow;
          return null;
        }
        if (sql.includes("MAX(version)")) {
          return { max_version: dbState.manifestVersions.length > 0 ? dbState.manifestVersions.length : null };
        }
        return null;
      },
      async run() {
        if (sql.startsWith("INSERT INTO artifact_manifests")) {
          dbState.manifestVersions.push({
            id: this.bindArgs[0],
            artifactId: this.bindArgs[1],
            version: this.bindArgs[2],
          });
        }
        if (sql.startsWith("UPDATE artifacts")) {
          dbState.updated = {
            bundle_digest: this.bindArgs[0],
            runtime_version: this.bindArgs[1],
            status: this.bindArgs[2],
            visibility: this.bindArgs[3],
            policy_status: this.bindArgs[4],
            id: this.bindArgs[5],
          };
        }
        return { success: true };
      },
    };
    return stmt;
  });

  const r2Puts: Array<{ key: string; body: any; opts?: any }> = [];
  const R2 = {
    put: vi.fn(async (key: string, body: any, opts?: any) => {
      r2Puts.push({ key, body, opts });
    }),
  };

  return {
    DB: { prepare } as any,
    R2,
    vibecodr_analytics_engine,
    RUNTIME_MANIFEST_KV: {
      put: vi.fn(),
    },
    __state: dbState,
    __r2Puts: r2Puts,
  };
}

describe("ArtifactCompiler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    r2Mocks.listCapsuleFiles.mockResolvedValue([{ path: "index.tsx" }]);
    r2Mocks.downloadCapsuleFile.mockImplementation(async (_r2: any, _hash: string, path: string) => {
      const encoder = new TextEncoder();
      return {
        text: async () => (path === "index.tsx" ? "export default 42;" : ""),
        arrayBuffer: async () => encoder.encode("export default 42;").buffer,
      };
    });
  });

  it("returns 400 when artifactId is missing", async () => {
    const { state } = createState();
    const env = createEnv() as any;
    const compiler = new ArtifactCompiler(state, env);
    const req = new Request("https://example/compile", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await compiler.fetch(req);
    expect(res.status).toBe(400);
  });

  it("compiles and stores bundle + runtime manifest", async () => {
    const { state, storage } = createState();
    const env = createEnv() as any;
    const compiler = new ArtifactCompiler(state, env);
    const req = new Request("https://example/compile", {
      method: "POST",
      body: JSON.stringify({ artifactId: "artifact-1" }),
    });

    const res = await compiler.fetch(req);
    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.compiled).toBe(true);
    expect(body.bundleKey).toBe("artifacts/artifact-1/bundle.js");
    expect(body.runtimeManifestKey).toBe("artifacts/artifact-1/v1/runtime-manifest.json");

    expect(storage.put).toHaveBeenCalledWith(
      "lastCompileRequest",
      expect.objectContaining({ artifactId: "artifact-1" })
    );
    expect(storage.put).toHaveBeenCalledWith(
      "lastCompileResult",
      expect.objectContaining({ outcome: "success" })
    );

    expect(env.__r2Puts.find((p: any) => p.key.endsWith("bundle.js"))).toBeDefined();
    expect(env.__r2Puts.find((p: any) => p.key.endsWith("runtime-manifest.json"))).toBeDefined();

    expect(env.__state.updated).toBeTruthy();
    expect(env.__state.updated.status).toBe("active");
    expect(env.__state.updated.visibility).toBe("public");

    const analytics = env.vibecodr_analytics_engine.writeDataPoint as any;
    expect(analytics).toHaveBeenCalled();
  });
});
