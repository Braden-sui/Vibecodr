/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCapsule } from "./capsules";
import type { Env } from "../types";

const checkPublicRateLimitMock = vi.fn();
const getClientIpMock = vi.fn();

vi.mock("../rateLimit", () => ({
  checkPublicRateLimit: (...args: any[]) => checkPublicRateLimitMock(...args),
  getClientIp: (...args: any[]) => getClientIpMock(...args),
}));

function createEnv(): Env {
  const DB = {
    prepare: vi.fn(() => ({
      bind() {
        return this;
      },
      async all() {
        return { results: [{ id: "cap-1", owner_id: "u1", manifest_json: "{}", hash: "hash-1", created_at: 0 }] };
      },
      async first() {
        return { manifest_json: "{}", owner_id: "u1", hash: "hash-1" };
      },
      async run() {
        return { meta: { changes: 0 } };
      },
    })),
  } as any;

  const R2 = {
    get: vi.fn(async () => ({
      httpMetadata: {},
      arrayBuffer: async () => new ArrayBuffer(0),
      body: new ReadableStream(),
    })),
    list: vi.fn(async () => ({ objects: [] })),
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

describe("getCapsule public rate limits", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getClientIpMock.mockReturnValue("1.1.1.1");
  });

  it("returns 429 when rate limit denies", async () => {
    checkPublicRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1000 });

    const res = await getCapsule(new Request("https://worker.test/capsules/cap-1"), createEnv(), {} as any, { p1: "cap-1" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ code: "E-VIBECODR-0311" });
  });
});
