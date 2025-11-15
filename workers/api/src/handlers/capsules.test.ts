/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../index";
import { publishCapsule } from "./capsules";

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

function createEnv(): Env {
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
        return { results: [] };
      },
      async run() {
        return { success: true };
      },
      async first() {
        return undefined;
      },
    };
    return stmt;
  });

  const r2Store = new Map<
    string,
    {
      key: string;
      body: any;
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

  const kvStore = new Map<string, string>();
  const kvPut = vi.fn(async (key: string, value: string) => {
    kvStore.set(key, value);
  });
  const kvGet = vi.fn(async (key: string) => {
    return kvStore.get(key) ?? null;
  });

  return {
    DB: { prepare } as any,
    R2: {
      put,
      get,
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
  };
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

describe("publishCapsule runtime artifacts", () => {
  let env: Env;

  beforeEach(() => {
    env = createEnv();
    vi.clearAllMocks();
  });

  it("emits runtime manifest for html entry", async () => {
    const manifest = {
      version: "1.0",
      runner: "client-static",
      entry: "index.html",
    };

    const req = createPublishRequest(manifest, "index.html", "<html><body>ok</body></html>");

    const res = await publishCapsule(req, env, {} as any, {} as any);
    expect(res.status).toBe(200);

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
});
