/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { oEmbedHandler, ogImageHandler } from "./embeds";
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
          if (sql.includes("FROM posts")) {
            return { id: "post1", type: "app", title: "Post Title", description: "desc", author_handle: "alice", author_name: "Alice", capsule_id: null, manifest_json: null };
          }
          if (sql.includes("SELECT p.title")) {
            return { title: "Post Title", author_handle: "alice" };
          }
          return undefined;
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    }),
  } as any;

  return {
    DB,
    R2: {} as any,
    ALLOWLIST_HOSTS: "[]",
    RUNTIME_MANIFEST_KV: {} as any,
    CLERK_JWT_ISSUER: "",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    vibecodr_analytics_engine: {} as any,
  } as Env;
}

describe("embeds rate limits", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getClientIpMock.mockReturnValue("1.1.1.1");
  });

  it("oembed returns 429 when rate limited", async () => {
    checkPublicRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1000 });

    const req = new Request("https://worker.test/oembed?url=https://vibecodr.space/player/post1&format=json");
    const res = await oEmbedHandler(req, createEnv(), {} as any, {} as any);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ code: "E-VIBECODR-0313" });
  });

  it("og-image returns 429 when rate limited", async () => {
    checkPublicRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1000 });

    const req = new Request("https://worker.test/og-image/post1");
    const res = await ogImageHandler(req, createEnv(), {} as any, { p1: "post1" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ code: "E-VIBECODR-0314" });
  });
});
