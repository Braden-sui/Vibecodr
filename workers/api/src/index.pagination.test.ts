import { beforeEach, describe, expect, it, vi } from "vitest";
import app, { type Env } from "./index";

vi.mock("./auth", () => ({
  verifyAuth: vi.fn().mockResolvedValue(null),
  isModeratorOrAdmin: vi.fn().mockReturnValue(false),
  isAdmin: vi.fn().mockReturnValue(false),
  requireAuth:
    (handler: any) =>
    (req: Request, env: any, ctx: any, params: any) =>
      handler(req, env, ctx, params, { userId: "test-user-id", sessionId: "session1", claims: {} }),
  requireAdmin:
    (handler: any) =>
    (req: Request, env: any, ctx: any, params: any) =>
      handler(req, env, ctx, params, { userId: "test-user-id", sessionId: "session1", claims: { role: "admin" } }),
  requireUser:
    (handler: any) =>
    (...args: any[]) =>
      handler(...args, "test-user-id"),
  __resetAuthStateForTests: vi.fn(),
}));

describe("getPosts pagination hardening", () => {
  const prepareCalls: Array<{ query: string; bindings: any[] }> = [];
  const mockDb = {
    prepare: vi.fn((query: string) => ({
      bind: (...bindings: any[]) => {
        prepareCalls.push({ query, bindings });
        return {
          all: vi.fn(async () => ({ results: [] })),
        };
      },
    })),
  };

  const env = {
    DB: mockDb,
  } as unknown as Env;

  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    prepareCalls.length = 0;
    mockDb.prepare.mockClear();
  });

  it("rejects non-integer pagination inputs", async () => {
    const req = new Request("https://example.com/posts?limit=abc&offset=1");
    const res = await app.fetch(req, env, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("E-VIBECODR-0401 invalid pagination");
    expect(prepareCalls.length).toBe(0);
  });

  it("rejects negative offsets", async () => {
    const req = new Request("https://example.com/posts?limit=10&offset=-5");
    const res = await app.fetch(req, env, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("E-VIBECODR-0404 invalid pagination");
    expect(prepareCalls.length).toBe(0);
  });

  it("clamps oversized limits before querying", async () => {
    const req = new Request("https://example.com/posts?limit=5000&offset=3");
    const res = await app.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(3);
    expect(prepareCalls).toHaveLength(1);
    expect(prepareCalls[0].bindings.slice(-2)).toEqual([50, 3]);
  });
});
