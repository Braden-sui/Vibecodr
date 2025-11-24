/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";
import type { Env } from "../types";
import { importZip } from "./import";
import { Plan, getUserPlan, getUserRunQuotaState } from "../storage/quotas";

const uploadCapsuleBundleMock = vi.fn();
const enforceSafetyForFilesMock = vi.fn();
const sanitizeHtmlEntryIfNeededMock = vi.fn((files: any, _manifest: any) => {
  const totalSize = files.reduce((acc: number, file: any) => acc + file.size, 0);
  return { files, totalSize };
});
const bundleWithEsbuildMock = vi.fn(async (files: Map<string, Uint8Array>, entryPoint: string) => ({
  files,
  entryPoint,
  warnings: [],
}));

vi.mock("../storage/quotas", async () => {
  const actual = await vi.importActual<typeof import("../storage/quotas")>("../storage/quotas");
  return {
    ...actual,
    getUserRunQuotaState: vi.fn(),
    getUserPlan: vi.fn(),
  };
});

vi.mock("./capsules", async () => {
  const actual = await vi.importActual<typeof import("./capsules")>("./capsules");
  return {
    ...actual,
    enforceSafetyForFiles: (...args: Parameters<typeof enforceSafetyForFilesMock>) =>
      enforceSafetyForFilesMock(...args),
    sanitizeHtmlEntryIfNeeded: (...args: Parameters<typeof sanitizeHtmlEntryIfNeededMock>) =>
      sanitizeHtmlEntryIfNeededMock(...args),
  };
});

vi.mock("../runtime/esbuildBundler", () => ({
  bundleWithEsbuild: (...args: Parameters<typeof bundleWithEsbuildMock>) =>
    bundleWithEsbuildMock(...args),
}));

vi.mock("../storage/r2", async () => {
  const actual = await vi.importActual<typeof import("../storage/r2")>("../storage/r2");
  return {
    ...actual,
    uploadCapsuleBundle: (...args: Parameters<typeof uploadCapsuleBundleMock>) =>
      uploadCapsuleBundleMock(...args),
  };
});

vi.mock("../auth", () => ({
  requireAuth:
    (handler: any) =>
    (req: Request, env: Env, ctx: any, params: Record<string, string>) =>
      handler(req, env, ctx, params, {
        userId: "user-1",
        sessionId: "sess-1",
        claims: {} as any,
      }),
}));

type TestEnv = Env & { __capsules: any[]; __assets: any[]; __storage: { usage: number; version: number; plan: Plan } };

function createEnv(): TestEnv {
  const capsules: any[] = [];
  const assets: any[] = [];
  const storage = { usage: 0, version: 0, plan: Plan.FREE };
  const DB = {
    prepare: vi.fn((sql: string) => {
      const stmt: any = {
        bindArgs: [] as any[],
        bind(...args: any[]) {
          this.bindArgs = args;
          return this;
        },
        all: async () => {
          if (sql.includes("FROM users")) {
            return {
              results: [
                {
                  plan: storage.plan,
                  storage_usage_bytes: storage.usage,
                  storage_version: storage.version,
                },
              ],
            };
          }
          return { results: [] };
        },
        first: async () => undefined,
        async run() {
          if (sql.startsWith("INSERT INTO capsules")) {
            const [id, ownerId, manifestJson, hash, createdAt] = this.bindArgs;
            capsules.push({ id, ownerId, manifestJson, hash, createdAt });
          }
          if (sql.startsWith("INSERT INTO assets")) {
            const [id, capsuleId, key, size] = this.bindArgs;
            assets.push({ id, capsuleId, key, size });
          }
          if (sql.includes("UPDATE users") && sql.includes("storage_usage_bytes")) {
            const [delta, userId, expectedVersion] = this.bindArgs;
            if (expectedVersion !== storage.version) {
              return { meta: { changes: 0 } };
            }
            storage.usage += delta;
            storage.version += 1;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    }),
  } as any;

  const R2 = {
    put: vi.fn(),
    list: vi.fn().mockResolvedValue({ objects: [] }),
  } as any;

  return {
    DB,
    R2,
    RUNTIME_MANIFEST_KV: {} as any,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "https://clerk.example",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    vibecodr_analytics_engine: {} as any,
    __capsules: capsules,
    __assets: assets,
    __storage: storage,
  } as any;
}

const getUserPlanMock = vi.mocked(getUserPlan);
const getUserRunQuotaStateMock = vi.mocked(getUserRunQuotaState);

describe("import handlers success path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserPlanMock.mockResolvedValue(Plan.FREE);
    getUserRunQuotaStateMock.mockResolvedValue({
      plan: Plan.FREE,
      runsThisMonth: 0,
      result: { allowed: true, limits: { maxRuns: 5000 } as any },
    });
    uploadCapsuleBundleMock.mockResolvedValue({
      contentHash: "hash-123",
      totalSize: 1024,
      fileCount: 2,
    });
  });

  it("imports a ZIP and returns draft capsule summary", async () => {
    const env = createEnv();
    const zip = new JSZip();
    zip.file("index.html", "<!doctype html><html><body>Hello</body></html>");
    const buffer = await zip.generateAsync({ type: "arraybuffer" });

    const res = await importZip(
      new Request("https://worker.test/import/zip", {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: buffer,
      }),
      env,
      {} as any,
      {} as any
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      capsuleId: string;
      manifest: any;
      filesSummary: { contentHash: string; entryPoint: string };
      warnings?: any[];
    };

    expect(body.capsuleId).toBeTruthy();
    expect(body.manifest.entry).toBe("index.html");
    expect(body.manifest.runner).toBe("client-static");
    expect(body.filesSummary.contentHash).toBe("hash-123");
    expect(body.filesSummary.entryPoint).toBe("index.html");
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(uploadCapsuleBundleMock).toHaveBeenCalledTimes(1);
    expect(env.__capsules.length).toBe(1);
    expect(env.__assets.length).toBeGreaterThan(0);
    expect(env.__storage.usage).toBeGreaterThan(0);
    expect(env.__storage.version).toBe(1);
  });
});
