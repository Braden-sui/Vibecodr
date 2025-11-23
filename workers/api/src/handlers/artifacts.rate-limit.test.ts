/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getArtifactManifest } from "./artifacts";
import type { Env } from "../index";

const checkPublicRateLimitMock = vi.fn();
const getClientIpMock = vi.fn();

vi.mock("../rateLimit", () => ({
  checkPublicRateLimit: (...args: any[]) => checkPublicRateLimitMock(...args),
  getClientIp: (...args: any[]) => getClientIpMock(...args),
}));

function createEnv(): Env {
  const DB = {
    prepare: vi.fn((sql: string) => {
      const stmt: any = {
        bindArgs: [] as any[],
        bind(...args: any[]) {
          this.bindArgs = args;
          return this;
        },
        async first() {
          if (sql.includes("FROM artifacts")) {
            return {
              id: "art-1",
              owner_id: "u1",
              type: "html",
              runtime_version: "v1",
              status: "active",
              policy_status: "active",
              visibility: "public",
            };
          }
          if (sql.includes("FROM artifact_manifests")) {
            return { manifest_json: "{}", version: 1, runtime_version: "v1" };
          }
          return undefined;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    }),
  } as any;

  const R2 = {
    get: vi.fn(async () => ({ text: async () => "{}", httpMetadata: { contentType: "application/json" }, body: new ReadableStream() })),
  } as any;

  return {
    DB,
    R2,
    ALLOWLIST_HOSTS: "[]",
    RUNTIME_MANIFEST_KV: {} as any,
    CLERK_JWT_ISSUER: "",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    vibecodr_analytics_engine: {} as any,
  };
}

describe("getArtifactManifest public rate limits", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getClientIpMock.mockReturnValue("1.1.1.1");
  });

  it("returns 429 when rate limit denies", async () => {
    checkPublicRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 2000 });

    const res = await getArtifactManifest(
      new Request("https://worker.test/artifacts/art-1/manifest"),
      createEnv(),
      {} as any,
      { p1: "art-1" }
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ code: "E-VIBECODR-0312" });
  });
});
