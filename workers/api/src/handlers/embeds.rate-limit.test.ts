/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EMBED_IFRAME_ALLOW,
  EMBED_IFRAME_SANDBOX,
  EMBED_PERMISSIONS_POLICY_HEADER,
  embedIframeHandler,
  oEmbedHandler,
  ogImageHandler,
} from "./embeds";
import type { Env } from "../types";

const checkPublicRateLimitMock = vi.fn();
const getClientIpMock = vi.fn();

vi.mock("../rateLimit", () => ({
  checkPublicRateLimit: (...args: any[]) => checkPublicRateLimitMock(...args),
  getClientIp: (...args: any[]) => getClientIpMock(...args),
}));

function createEnv(): Env {
  const DB = {
    prepare: vi.fn((sql: string) => {
      const normalized = sql.toLowerCase();
      const postRow = {
        id: "post1",
        type: "app",
        title: "Post Title",
        description: "desc",
        author_handle: "alice",
        author_name: "Alice",
        capsule_id: null,
        manifest_json: null,
        cover_key: null,
        visibility: "public",
        quarantined: 0,
        author_suspended: 0,
        author_shadow_banned: 0,
      };
      const stmt: any = {
        bindArgs: [] as any[],
        bind(...args: any[]) {
          this.bindArgs = args;
          return this;
        },
        async first() {
          if (normalized.includes("select p.title")) {
            return { title: "Post Title", author_handle: "alice" };
          }
          return undefined;
        },
        async all() {
          if (normalized.includes("pragma table_info(posts)")) {
            return {
              results: [
                { name: "id" },
                { name: "visibility" },
                { name: "quarantined" },
              ],
            };
          }
          if (normalized.includes("from posts")) {
            return { results: [postRow] };
          }
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
    checkPublicRateLimitMock.mockResolvedValue({ allowed: true, remaining: 59, resetAt: Date.now() + 60_000 });
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

  it("embed iframe returns 429 when rate limited", async () => {
    checkPublicRateLimitMock.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 1000 });

    const req = new Request("https://worker.test/e/post1");
    const res = await embedIframeHandler(req, createEnv(), {} as any, { p1: "post1" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ code: "E-VIBECODR-0315" });
  });

  it("oembed returns rich payload for a player url", async () => {
    const req = new Request("https://worker.test/oembed?url=https://vibecodr.space/player/post1&format=json&maxwidth=640");
    const res = await oEmbedHandler(req, createEnv(), {} as any, {} as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provider_name: string;
      html: string;
      thumbnail_url: string;
      width: number;
      height: number;
      author_url: string;
    };
    expect(body.provider_name).toBe("Vibecodr");
    expect(body.html).toContain("/e/post1");
    expect(body.thumbnail_url).toContain("/api/og-image/post1");
    expect(body.width).toBeGreaterThanOrEqual(320);
    expect(body.height).toBeGreaterThan(0);
    expect(body.author_url).toContain("/u/alice");
  });

  it("sets sandbox, CSP, and permissions headers on the embed iframe page", async () => {
    const req = new Request("https://worker.test/e/post1");
    const res = await embedIframeHandler(req, createEnv(), {} as any, { p1: "post1" });

    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors *");
    expect(res.headers.get("Permissions-Policy")).toBe(EMBED_PERMISSIONS_POLICY_HEADER);

    const body = await res.text();
    expect(body).toContain(`sandbox=\"${EMBED_IFRAME_SANDBOX}\"`);
    expect(body).toContain(`allow=\"${EMBED_IFRAME_ALLOW}\"`);
  });
});
