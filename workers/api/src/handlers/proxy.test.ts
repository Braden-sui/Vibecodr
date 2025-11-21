/// <reference types="vitest" />
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Env } from "../index";
import { netProxy, isHostAllowed, isAllowedProtocol, getBlockedAddressReason } from "./proxy";

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

const createEnv = (options?: { manifestHosts?: string[]; envAllowlist?: string[]; ownerId?: string; runtimeKv?: boolean }) => {
  const manifest = {
    ...baseManifest,
    capabilities: options?.manifestHosts ? { net: options.manifestHosts } : undefined,
  };

  const stmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({
      owner_id: options?.ownerId ?? "user-1",
      manifest_json: JSON.stringify(manifest),
    }),
  };

  return {
    DB: {
      prepare: vi.fn().mockReturnValue(stmt),
    },
    R2: {} as any,
    RUNTIME_MANIFEST_KV: options?.runtimeKv === false ? undefined : createKv(),
    ALLOWLIST_HOSTS: JSON.stringify(options?.envAllowlist ?? []),
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
  it("proxies requests for allowlisted hosts", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"] });
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

  it("rejects hosts that are not in the allowlist", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"] });
    vi.stubGlobal("fetch", vi.fn());

    const request = new Request("https://worker.test/proxy?url=https://evil.example.com&capsuleId=caps1");
    const response = await netProxy(request, env as Env, {} as any, {} as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Host not in allowlist" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects proxy requests for capsules not owned by the caller", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"], ownerId: "other-user" });
    vi.stubGlobal("fetch", vi.fn());

    const request = new Request("https://worker.test/proxy?url=https://api.github.com/repos&capsuleId=caps1");
    const response = await netProxy(request, env as Env, {} as any, {} as any);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Forbidden" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("enforces rate limits with in-memory fallback when KV binding is missing", async () => {
    const env = createEnv({ manifestHosts: ["api.github.com"], runtimeKv: false });
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
