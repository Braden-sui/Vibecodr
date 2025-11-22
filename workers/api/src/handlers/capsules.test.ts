/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../index";
import type { AuthenticatedUser } from "../auth";
import { generateBundleHash, type CapsuleFile } from "../storage/r2";
import type { Manifest } from "@vibecodr/shared/manifest";
import { publishCapsule, persistCapsuleBundle } from "./capsules";

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

type CapsuleRecord = {
  id: string;
  hash: string;
};

type MockDbState = {
  plan: string;
  storageUsage: number;
  storageVersion: number;
  forceReservationConflict: boolean;
  hasUserRow: boolean;
  capsules: CapsuleRecord[];
};

type TestEnv = Env & { __mockDbState: MockDbState };

type CreateEnvOptions = {
  plan?: string;
  storageUsage?: number;
  storageVersion?: number;
  forceReservationConflict?: boolean;
  hasUserRow?: boolean;
  capsules?: CapsuleRecord[];
  simulateUserInsertRace?: {
    resultingUsage?: number;
    resultingVersion?: number;
  };
  failUserInsert?: boolean;
};

function createEnv(options: CreateEnvOptions = {}): TestEnv {
  const dbState: MockDbState = {
    plan: options.plan ?? "free",
    storageUsage: options.storageUsage ?? 0,
    storageVersion: options.storageVersion ?? 0,
    forceReservationConflict: options.forceReservationConflict ?? false,
    hasUserRow: options.hasUserRow ?? true,
    capsules: options.capsules ? [...options.capsules] : [],
  };

  const insertRace = options.simulateUserInsertRace
    ? {
        triggered: false,
        resultingUsage: options.simulateUserInsertRace.resultingUsage ?? 0,
        resultingVersion: options.simulateUserInsertRace.resultingVersion ?? 1,
      }
    : null;
  const failUserInsert = options.failUserInsert ?? false;

  const prepare = vi.fn((sql: string) => {
    const stmt: any = {
      sql,
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async all() {
        if (sql.includes("SELECT plan, storage_usage_bytes, storage_version FROM users")) {
          if (!dbState.hasUserRow) {
            return { results: [] };
          }
          return {
            results: [
              {
                plan: dbState.plan,
                storage_usage_bytes: dbState.storageUsage,
                storage_version: dbState.storageVersion,
              },
            ],
          };
        }
        if (sql.includes("SELECT plan FROM users")) {
          if (!dbState.hasUserRow) {
            return { results: [] };
          }
          return { results: [{ plan: dbState.plan }] };
        }
        if (sql.includes("SELECT storage_usage_bytes FROM users")) {
          if (!dbState.hasUserRow) {
            return { results: [] };
          }
          return { results: [{ storage_usage_bytes: dbState.storageUsage }] };
        }
        if (sql.includes("SELECT storage_version FROM users WHERE id = ?")) {
          if (!dbState.hasUserRow) {
            return { results: [] };
          }
          return { results: [{ storage_version: dbState.storageVersion }] };
        }
        if (sql.includes("SELECT SUM(size) as total")) {
          return { results: [{ total: dbState.storageUsage }] };
        }
        if (sql.includes("SELECT COUNT(*)") && sql.includes("FROM capsules") && sql.includes("hash")) {
          const hash = this.bindArgs?.[0];
          const count = dbState.capsules.filter((capsule) => capsule.hash === hash).length;
          return { results: [{ count }] };
        }
        return { results: [] };
      },
      async run() {
        if (sql.includes("INSERT INTO users")) {
          if (failUserInsert) {
            const error: any = new Error("simulated user insert failure");
            throw error;
          }
          if (!dbState.hasUserRow) {
            if (insertRace && !insertRace.triggered) {
              insertRace.triggered = true;
              dbState.hasUserRow = true;
              dbState.storageUsage = insertRace.resultingUsage ?? 0;
              dbState.storageVersion = insertRace.resultingVersion ?? 1;
              const error: any = new Error("UNIQUE constraint failed: users.id");
              throw error;
            }
            dbState.hasUserRow = true;
            dbState.plan =
              typeof this.bindArgs?.[2] === "string" ? this.bindArgs[2] : dbState.plan;
            dbState.storageUsage =
              typeof this.bindArgs?.[3] === "number" ? this.bindArgs[3] : dbState.storageUsage;
            dbState.storageVersion =
              typeof this.bindArgs?.[4] === "number" ? this.bindArgs[4] : dbState.storageVersion;
            return { success: true, meta: { changes: 1 } };
          }
          const error: any = new Error("UNIQUE constraint failed: users.id");
          throw error;
        }
        if (sql.includes("INSERT INTO capsules")) {
          const capsuleId = this.bindArgs?.[0];
          const contentHash = this.bindArgs?.[3];
          if (capsuleId && typeof contentHash === "string") {
            dbState.capsules.push({ id: capsuleId, hash: contentHash });
          }
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO assets")) {
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("DELETE FROM assets")) {
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("DELETE FROM capsules")) {
          const capsuleId = this.bindArgs?.[0];
          if (capsuleId) {
            dbState.capsules = dbState.capsules.filter((capsule) => capsule.id !== capsuleId);
          }
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("UPDATE users") && sql.includes("storage_usage_bytes")) {
          if (!dbState.hasUserRow) {
            return { success: true, meta: { changes: 0 } };
          }
          if (dbState.forceReservationConflict) {
            return { success: true, meta: { changes: 0 } };
          }
          const expectedVersion = this.bindArgs[2];
          if (expectedVersion !== undefined && expectedVersion !== dbState.storageVersion) {
            return { success: true, meta: { changes: 0 } };
          }
          const delta = typeof this.bindArgs[0] === "number" ? this.bindArgs[0] : 0;
          dbState.storageUsage += delta;
          dbState.storageVersion += 1;
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 1 } };
      },
      async first() {
        const res = await this.all();
        return res.results?.[0];
      },
    };
    return stmt;
  });

  const r2Store = new Map<
    string,
    {
      key: string;
      body: any;
      size?: number;
      httpMetadata?: any;
      customMetadata?: any;
      json: () => Promise<any>;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }
  >();

  const put = vi.fn(async (key: string, body: any, options?: any) => {
    const entry = {
      key,
      body,
      size:
        typeof body === "string"
          ? new TextEncoder().encode(body).byteLength
          : body instanceof ArrayBuffer
            ? body.byteLength
            : 0,
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
      async json() {
        if (typeof body === "string") {
          try {
            return JSON.parse(body);
          } catch {
            return body;
          }
        }
        if (body instanceof ArrayBuffer) {
          const text = new TextDecoder().decode(new Uint8Array(body));
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        }
        return body;
      },
      async arrayBuffer() {
        if (body instanceof ArrayBuffer) {
          return body;
        }
        if (typeof body === "string") {
          return new TextEncoder().encode(body).buffer;
        }
        const text = JSON.stringify(body);
        return new TextEncoder().encode(text).buffer;
      },
    };
    r2Store.set(key, entry);
  });

  const get = vi.fn(async (key: string) => {
    return r2Store.get(key) ?? null;
  });

  const list = vi.fn(async ({ prefix }: { prefix?: string }) => {
    const objects = Array.from(r2Store.entries())
      .filter(([key]) => (prefix ? key.startsWith(prefix) : true))
      .map(([key, entry]) => ({
        key,
        size: entry.size ?? 0,
        customMetadata: entry.customMetadata ?? {},
      }));
    return { objects };
  });

  const remove = vi.fn(async (key: string) => {
    r2Store.delete(key);
  });

  const kvStore = new Map<string, string>();
  const kvPut = vi.fn(async (key: string, value: string) => {
    kvStore.set(key, value);
  });
  const kvGet = vi.fn(async (key: string) => {
    return kvStore.get(key) ?? null;
  });

  const envObj = {
    DB: { prepare } as any,
    R2: {
      put,
      get,
      list,
      delete: remove,
    } as any,
    RUNTIME_MANIFEST_KV: {
      put: kvPut,
      get: kvGet,
    } as any,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "https://clerk.example",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    vibecodr_analytics_engine: {} as any,
    RUNTIME_ARTIFACTS_ENABLED: "true",
  } as TestEnv;

  (envObj as any).__mockDbState = dbState;
  return envObj;
}

function createPublishRequest(manifest: unknown, entryPath: string, entryContent: string): Request {
  const manifestJson = JSON.stringify(manifest);

  const manifestFile = {
    async text() {
      return manifestJson;
    },
  } as any;

  const encoder = new TextEncoder();
  const entryBytes = encoder.encode(entryContent);
  const entryFile = {
    size: entryBytes.byteLength,
    type: "text/html",
    async arrayBuffer() {
      return entryBytes.buffer;
    },
  } as any;

  const entries: Array<[string, any]> = [
    ["manifest", manifestFile],
    [entryPath, entryFile],
  ];

  const formDataStub: any = {
    get(name: string) {
      const entry = entries.find(([key]) => key === name);
      return entry ? entry[1] : null;
    },
    [Symbol.iterator]() {
      return entries[Symbol.iterator]();
    },
  };

  const req = {
    async formData() {
      return formDataStub;
    },
  } as any as Request;

  return req;
}

function buildCapsuleBundle(entryHtml = "<html><body>ok</body></html>") {
  const manifest = {
    version: "1.0",
    runner: "client-static",
    entry: "index.html",
  } as Manifest;
  const manifestText = JSON.stringify(manifest);
  const encoder = new TextEncoder();
  const entryBytes = encoder.encode(entryHtml);
  const manifestBytes = encoder.encode(manifestText);
  const files: CapsuleFile[] = [
    {
      path: "index.html",
      content: entryBytes.buffer,
      contentType: "text/html",
      size: entryBytes.byteLength,
    },
    {
      path: "manifest.json",
      content: manifestBytes.buffer,
      contentType: "application/json",
      size: manifestBytes.byteLength,
    },
  ];
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  return { manifest, manifestText, files, totalSize };
}

describe("publishCapsule runtime artifacts", () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createEnv();
    vi.clearAllMocks();
  });

  type PublishCapsuleResponse = {
    artifactId?: string;
    capsule?: { id?: string; contentHash?: string };
    artifact?: { id?: string };
  };

  it("emits runtime manifest for html entry", async () => {
    const manifest = {
      version: "1.0",
      runner: "client-static",
      entry: "index.html",
    };

    const req = createPublishRequest(manifest, "index.html", "<html><body>ok</body></html>");

    const res = await publishCapsule(req, env, {} as any, {} as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublishCapsuleResponse;
    expect(body.capsule?.id).toBeDefined();
    expect(body.artifact?.id).toBeDefined();
    expect(body.artifactId).toBe(body.artifact?.id);
    expect(body.capsule?.contentHash).toBeDefined();

    const r2Put = (env.R2 as any).put as ReturnType<typeof vi.fn>;
    const putCalls = r2Put.mock.calls as any[];
    const manifestCall = putCalls.find(([key]) => String(key).includes("artifacts/") && String(key).endsWith("runtime-manifest.json"));
    expect(manifestCall).toBeTruthy();

    const kvPut = (env.RUNTIME_MANIFEST_KV as any).put as ReturnType<typeof vi.fn>;
    const kvCalls = kvPut.mock.calls as any[];
    const kvManifestCall = kvCalls.find(([key]) => String(key).includes("artifacts/") && String(key).endsWith("runtime-manifest.json"));
    expect(kvManifestCall).toBeTruthy();

    const dbPrepare = (env.DB as any).prepare as ReturnType<typeof vi.fn>;
    const sqlCalls = dbPrepare.mock.calls.map((args: any[]) => args[0] as string);
    expect(sqlCalls.some((sql) => sql.includes("INSERT INTO artifacts"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("INSERT INTO artifact_manifests"))).toBe(true);
  });

  it("fails publish when runtime artifact creation fails", async () => {
    const manifest = {
      version: "1.0",
      runner: "client-static",
      entry: "index.html",
    };

    const req = createPublishRequest(manifest, "index.html", "<html><body>ok</body></html>");
    const originalPut = ((env.R2 as any).put as ReturnType<typeof vi.fn>).getMockImplementation();
    ((env.R2 as any).put as ReturnType<typeof vi.fn>).mockImplementation(async (key: string, body: any, opts?: any) => {
      if (String(key).includes("runtime-manifest.json")) {
        throw new Error("artifact manifest write failed");
      }
      return originalPut ? await originalPut(key, body, opts) : undefined;
    });

    const res = await publishCapsule(req, env, {} as any, {} as any);
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.code).toBe("E-VIBECODR-0503");
  });
});

describe("persistCapsuleBundle storage reservations", () => {
  const user: AuthenticatedUser = {
    userId: "storage-user",
    sessionId: "sess-storage",
    claims: {} as any,
  };

  it("increments storage usage when reservation succeeds", async () => {
    const env = createEnv();
    const bundle = buildCapsuleBundle();

    const result = await persistCapsuleBundle({
      env,
      user,
      manifest: bundle.manifest,
      manifestText: bundle.manifestText,
      files: bundle.files,
      totalSize: bundle.totalSize,
    });

    expect(result.capsule.id).toBeDefined();
    expect(env.__mockDbState.storageUsage).toBe(bundle.totalSize);
    expect(env.__mockDbState.storageVersion).toBe(1);
  });

  it("cleans up when reservation conflicts occur", async () => {
    const env = createEnv({ forceReservationConflict: true });
    const bundle = buildCapsuleBundle();

    await expect(
      persistCapsuleBundle({
        env,
        user,
        manifest: bundle.manifest,
        manifestText: bundle.manifestText,
        files: bundle.files,
        totalSize: bundle.totalSize,
      })
    ).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: "E-VIBECODR-CONCURRENT-UPLOAD" }),
    });

    const dbPrepare = (env.DB as any).prepare as ReturnType<typeof vi.fn>;
    const sqlCalls = dbPrepare.mock.calls.map((args: any[]) => args[0] as string);
    expect(sqlCalls.some((sql) => sql.includes("DELETE FROM assets"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("DELETE FROM capsules"))).toBe(true);

    const r2Delete = (env.R2 as any).delete as ReturnType<typeof vi.fn>;
    expect(r2Delete).toHaveBeenCalled();
    expect(env.__mockDbState.storageUsage).toBe(0);
  });

  it("skips R2 cleanup when reservation conflicts happen on shared bundles", async () => {
    const bundle = buildCapsuleBundle();
    const contentHash = await generateBundleHash(bundle.files);
    const env = createEnv({
      forceReservationConflict: true,
      capsules: [{ id: "existing-capsule", hash: contentHash }],
    });

    await expect(
      persistCapsuleBundle({
        env,
        user,
        manifest: bundle.manifest,
        manifestText: bundle.manifestText,
        files: bundle.files,
        totalSize: bundle.totalSize,
      })
    ).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: "E-VIBECODR-CONCURRENT-UPLOAD" }),
    });

    const r2Delete = (env.R2 as any).delete as ReturnType<typeof vi.fn>;
    expect(r2Delete).not.toHaveBeenCalled();
    expect(env.__mockDbState.capsules).toEqual([{ id: "existing-capsule", hash: contentHash }]);
  });

  it("bootstraps storage accounting when the user row is missing", async () => {
    const env = createEnv({ hasUserRow: false });
    const bundle = buildCapsuleBundle();

    const result = await persistCapsuleBundle({
      env,
      user,
      manifest: bundle.manifest,
      manifestText: bundle.manifestText,
      files: bundle.files,
      totalSize: bundle.totalSize,
    });

    expect(result.capsule.id).toBeDefined();
    expect(env.__mockDbState.hasUserRow).toBe(true);
    expect(env.__mockDbState.storageUsage).toBe(bundle.totalSize);
    expect(env.__mockDbState.storageVersion).toBe(1);
  });

  it("retries reservation when another insert wins the race", async () => {
    const existingUsage = 4096;
    const env = createEnv({
      hasUserRow: false,
      simulateUserInsertRace: {
        resultingUsage: existingUsage,
        resultingVersion: 1,
      },
    });
    const bundle = buildCapsuleBundle();

    const result = await persistCapsuleBundle({
      env,
      user,
      manifest: bundle.manifest,
      manifestText: bundle.manifestText,
      files: bundle.files,
      totalSize: bundle.totalSize,
    });

    expect(result.capsule.id).toBeDefined();
    expect(env.__mockDbState.storageUsage).toBe(existingUsage + bundle.totalSize);
    expect(env.__mockDbState.storageVersion).toBe(2);
  });

  it("cleans up persisted state when bootstrap insert fails", async () => {
    const env = createEnv({
      hasUserRow: false,
      failUserInsert: true,
    });
    const bundle = buildCapsuleBundle();

    await expect(
      persistCapsuleBundle({
        env,
        user,
        manifest: bundle.manifest,
        manifestText: bundle.manifestText,
        files: bundle.files,
        totalSize: bundle.totalSize,
      })
    ).rejects.toMatchObject({
      status: 500,
      body: expect.objectContaining({ code: "E-VIBECODR-0410" }),
    });

    expect(env.__mockDbState.capsules).toEqual([]);
    expect(env.__mockDbState.storageUsage).toBe(0);
    expect((env.R2 as any).delete).toHaveBeenCalled();
  });
});
