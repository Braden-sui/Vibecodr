/// <reference types="vitest" />
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Env } from "../index";
import { netProxy, isHostAllowed, isAllowedProtocol, getBlockedAddressReason } from "./proxy";
import { Plan } from "../storage/quotas";

vi.mock("../auth", () => {
  return {
    requireUser:
      (handler: any) =>
      (req: Request, env: Env, ctx: any, params: any) =>
        handler(req, env, ctx, params, "user-1"),
  };
});

const baseManifest = {
  version: "1.0" as const,
  runner: "client-static" as const,
  entry: "index.html",
};

const createKv = () => {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as any;
};

const createEnv = (options?: {
  manifestHosts?: string[];
  envAllowlist?: string[];
  ownerId?: string;
  runtimeKv?: boolean;
  proxyEnabled?: boolean;
  plan?: Plan;
}) => {
  const manifest = {
    ...baseManifest,
    capabilities: options?.manifestHosts ? { net: options.manifestHosts } : undefined,
  };

  const rateLimits = new Map<string, { count: number; resetAt: number }>();
  const ownerId = options?.ownerId ?? "user-1";
  const plan = options?.plan ?? Plan.PRO;

  const prepare = vi.fn((sql: string) => {
    const stmt: any = {
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async first() {
        if (sql.includes("FROM capsules")) {
          return {
            owner_id: ownerId,
            manifest_json: JSON.stringify(manifest),
          };
        }
        if (sql.includes("FROM users")) {
          return { plan };
        }
        if (sql.includes("SELECT count, reset_at FROM proxy_rate_limits")) {
          const key = this.bindArgs[0];
          const row = rateLimits.get(key);
          return row ? { count: row.count, reset_at: row.resetAt } : undefined;
        }
        return undefined;
      },
      async all() {
        if (sql.includes("FROM users")) {
          return {
            results: [
              {
                plan,
                storage_usage_bytes: 0,
                storage_version: 0,
              },
            ],
          };
        }
        return { results: [] };
      },
      async run() {
        if (sql.startsWith("CREATE TABLE IF NOT EXISTS proxy_rate_limits")) {
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith("INSERT INTO proxy_rate_limits")) {
          const [key, count, resetAt, updateCount, updateResetAt] = this.bindArgs;
          if (rateLimits.has(key)) {
            rateLimits.set(key, { count: updateCount, resetAt: updateResetAt });
          } else {
            rateLimits.set(key, { count, resetAt });
          }
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE proxy_rate_limits SET count = ? WHERE key = ?")) {
          const [count, key] = this.bindArgs;
          const existing = rateLimits.get(key) || { count: 0, resetAt: Math.floor(Date.now() / 1000) + 60 };
          rateLimits.set(key, { ...existing, count });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      },
    };
    return stmt;
  });

  return {
    DB: {
      prepare,
    },
    R2: {} as any,
    RUNTIME_MANIFEST_KV: options?.runtimeKv === false ? undefined : createKv(),
    ALLOWLIST_HOSTS: JSON.stringify(options?.envAllowlist ?? options?.manifestHosts ?? []),
    NET_PROXY_ENABLED: options?.proxyEnabled ? "true" : undefined,
  } as unknown as Env;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isHostAllowed", () => {
  it("allows exact host matches on default ports", () => {
    expect(isHostAllowed(new URL("https://api.github.com/repos"), ["api.github.com"])).toBe(true);
    expect(isHostAllowed(new URL("http://api.github.com/repos"), ["api.github.com"])).toBe(true);
  });

  it("supports wildcard subdomains", () => {
    expect(isHostAllowed(new URL("https://sub.service.example.com"), ["*.example.com"])).toBe(true);
  });

  it("rejects custom ports unless explicitly allowlisted", () => {
    const url = new URL("https://api.example.com:8443/data");
    expect(isHostAllowed(url, ["api.example.com"])).toBe(false);
    expect(isHostAllowed(url, ["api.example.com:8443"])).toBe(true);
  });
});

describe("proxy policy helpers", () => {
  it("only allows http and https protocols", () => {
    expect(isAllowedProtocol("http:")).toBe(true);
    expect(isAllowedProtocol("https:")).toBe(true);
    expect(isAllowedProtocol("ftp:")).toBe(false);
    expect(isAllowedProtocol("file:")).toBe(false);
  });

  it("blocks localhost and IP literals", () => {
    expect(getBlockedAddressReason("localhost")).not.toBeNull();
    expect(getBlockedAddressReason("127.0.0.1")).not.toBeNull();
    expect(getBlockedAddressReason("10.10.0.1")).not.toBeNull();
    expect(getBlockedAddressReason("::1")).not.toBeNull();
    expect(getBlockedAddressReason("example.com")).toBeNull();
  });
});

describe("netProxy integration", () => {
  it("returns disabled response when feature flag is off", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"] });
    vi.stubGlobal("fetch", vi.fn());

    const request = new Request("https://worker.test/proxy?url=https://api.github.com/repos&capsuleId=caps1");
    const response = await netProxy(request, env as Env, {} as any, {} as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "E-VIBECODR-0300" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects when ALLOWLIST_HOSTS is empty", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"], envAllowlist: [], proxyEnabled: true });
    vi.stubGlobal("fetch", vi.fn());

    const request = new Request("https://worker.test/proxy?url=https://api.github.com/repos&capsuleId=caps1");
    const response = await netProxy(request, env as Env, {} as any, {} as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "E-VIBECODR-0306" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("proxies requests for allowlisted hosts", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"], proxyEnabled: true });
    const fetchMock = vi.fn(async () => new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://worker.test/proxy?url=https://api.github.com/repos&capsuleId=caps1");
    const response = await netProxy(request, env as Env, {} as any, {} as any);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects free plan users when proxy is not enabled for free tier", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"], proxyEnabled: true, plan: Plan.FREE });
    vi.stubGlobal("fetch", vi.fn());

    const request = new Request("https://worker.test/proxy?url=https://api.github.com/repos&capsuleId=caps1");
    const response = await netProxy(request, env as Env, {} as any, {} as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "E-VIBECODR-0305" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects hosts that are not in the allowlist", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"], proxyEnabled: true });
    vi.stubGlobal("fetch", vi.fn());

    const request = new Request("https://worker.test/proxy?url=https://evil.example.com&capsuleId=caps1");
    const response = await netProxy(request, env as Env, {} as any, {} as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Host not in allowlist" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects proxy requests for capsules not owned by the caller", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"], ownerId: "other-user", proxyEnabled: true });
    vi.stubGlobal("fetch", vi.fn());

    const request = new Request("https://worker.test/proxy?url=https://api.github.com/repos&capsuleId=caps1");
    const response = await netProxy(request, env as Env, {} as any, {} as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Forbidden" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("enforces rate limits with in-memory fallback when KV binding is missing", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"], runtimeKv: false, proxyEnabled: true });
    const fetchMock = vi.fn(async () => new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const makeRequest = () =>
      new Request("https://worker.test/proxy?url=https://api.github.com/repos&capsuleId=caps1");

    try {
      const firstResponse = await netProxy(makeRequest(), env as Env, {} as any, {} as any);
      expect(firstResponse.status).toBe(200);

      const limitHeader = firstResponse.headers.get("X-RateLimit-Limit");
      const limit = Number(limitHeader || 0);
      expect(Number.isFinite(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);

      for (let i = 1; i < limit; i++) {
        const response = await netProxy(makeRequest(), env as Env, {} as any, {} as any);
        expect(response.status).toBe(200);
      }

      const blockedResponse = await netProxy(makeRequest(), env as Env, {} as any, {} as any);
      expect(blockedResponse.status).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(limit);

      const misconfigLog = consoleErrorSpy.mock.calls.find(
        ([message]) => typeof message === "string" && message.includes("E-VIBECODR-0304")
      );
      expect(misconfigLog).toBeTruthy();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
