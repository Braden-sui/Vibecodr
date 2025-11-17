/// <reference types="vitest" />
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Env } from "../index";

vi.mock("../auth", () => {
  return {
    requireUser:
      (handler: any) =>
      (req: any, env: Env, ctx: any, params: any) =>
        handler(req, env, ctx, params, "u1"),
    requireAuth:
      (handler: any) =>
      (req: any, env: Env, ctx: any, params: any) =>
        handler(req, env, ctx, params, {
          userId: "u1",
          sessionId: "sess1",
          claims: {} as any,
        }),
    isModeratorOrAdmin: () => false,
    verifyAuth: vi.fn(),
  };
});

vi.mock("./counters", () => ({
  incrementPostStats: vi.fn(async () => {}),
}));

import { incrementPostStats } from "./counters";
import { followUser, unfollowUser, likePost, unlikePost, createComment, deleteComment } from "./social";

const createEnv = (): Env => ({
  DB: {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
    batch: vi.fn(async (statements: any[]) => statements.map(() => ({ success: true, meta: { changes: 1 } }))),
  } as any,
  R2: {} as any,
  ALLOWLIST_HOSTS: "[]",
} as any);

function req(method: string, url: string, authUser: string | null = "u1", body?: unknown) {
  const headers: Record<string, string> = {};
  if (authUser) headers.Authorization = `Bearer ${authUser}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("https://api.example" + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("Counters wiring", () => {
  let env: Env;
  beforeEach(() => {
    env = createEnv();
    vi.clearAllMocks();
  });

  it("batches follow insert, counter updates, and notification", async () => {
    // user exists
    (env.DB as any).first.mockResolvedValueOnce({ id: "u2" });
    const batchSpy = (env.DB as any).batch;

    const res = await followUser(req("POST", "/users/u2/follow"), env as any, {} as any, { p1: "u2" } as any);
    expect(res.status).toBe(200);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const statements = batchSpy.mock.calls[0]?.[0];
    expect(Array.isArray(statements)).toBe(true);
    expect(statements).toHaveLength(4);
  });

  it("returns already following when the follow insert hits a unique constraint", async () => {
    (env.DB as any).first.mockResolvedValueOnce({ id: "u2" });
    (env.DB as any).batch.mockRejectedValueOnce(new Error("UNIQUE constraint failed: follows.followee_id"));

    const res = await followUser(req("POST", "/users/u2/follow"), env as any, {} as any, { p1: "u2" } as any);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { message?: string };
    expect(payload.message).toContain("Already following");
  });

  it(" surfaces follow failures when batch throws", async () => {
    (env.DB as any).first.mockResolvedValueOnce({ id: "u2" });
    (env.DB as any).batch.mockRejectedValueOnce(new Error("boom"));

    const res = await followUser(req("POST", "/users/u2/follow"), env as any, {} as any, { p1: "u2" } as any);
    expect(res.status).toBe(500);
    const payload = (await res.json()) as { error?: string };
    expect(payload.error).toBe("Failed to follow user");
  });

  it("batches counter updates before unfollow delete", async () => {
    const batchSpy = (env.DB as any).batch;

    const res = await unfollowUser(req("DELETE", "/users/u2/follow"), env as any, {} as any, { p1: "u2" } as any);
    expect(res.status).toBe(200);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    const statements = batchSpy.mock.calls[0]?.[0];
    expect(Array.isArray(statements)).toBe(true);
    expect(statements).toHaveLength(3);
  });

  it(" surfaces unfollow failures when batch throws", async () => {
    (env.DB as any).batch.mockRejectedValueOnce(new Error("delete failed"));

    const res = await unfollowUser(req("DELETE", "/users/u2/follow"), env as any, {} as any, { p1: "u2" } as any);
    expect(res.status).toBe(500);
    const payload = (await res.json()) as { error?: string };
    expect(payload.error).toBe("Failed to unfollow user");
  });

  it("updates post stats on like/unlike", async () => {
    // post exists
    ;(env.DB as any).first.mockResolvedValueOnce({ author_id: "u2" });
    ;(env.DB as any).run.mockResolvedValueOnce({}); // insert like
    ;(env.DB as any).run.mockResolvedValueOnce({}); // notification

    const ok1 = await likePost(req("POST", "/posts/p1/like"), env as any, {} as any, { p1: "p1" } as any);
    expect(ok1.status).toBe(200);
    expect(incrementPostStats).toHaveBeenCalledWith(env, "p1", { likesDelta: 1 });

    // unlike path
    ;(env.DB as any).run.mockResolvedValueOnce({});
    const ok2 = await unlikePost(req("DELETE", "/posts/p1/like"), env as any, {} as any, { p1: "p1" } as any);
    expect(ok2.status).toBe(200);
    expect(incrementPostStats).toHaveBeenCalledWith(env, "p1", { likesDelta: -1 });
  });

  it("updates post stats on comment create", async () => {
    (env.DB as any).first.mockResolvedValueOnce({ author_id: "u2" });
    (env.DB as any).run.mockResolvedValueOnce({});
    (env.DB as any).run.mockResolvedValueOnce({});
    (env.DB as any).first.mockResolvedValueOnce({
      id: "c1",
      body: "hello",
      at_ms: null,
      bbox: null,
      created_at: 123,
      user_id: "u1",
      handle: "u1",
      name: "User 1",
      avatar_url: null,
    });

    const res = await createComment(
      req("POST", "/posts/p1/comments", "u1", { body: "hello" }),
      env as any,
      {} as any,
      { p1: "p1" } as any
    );

    expect(res.status).toBe(201);
    expect(incrementPostStats).toHaveBeenCalledWith(env, "p1", { commentsDelta: 1 });
  });

  it("rejects invalid comment payload before touching storage", async () => {
    const res = await createComment(
      req("POST", "/posts/p1/comments", "u1", { body: "" }),
      env as any,
      {} as any,
      { p1: "p1" } as any
    );

    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error?: string; code?: string };
    expect(payload.error).toBe("Invalid comment data");
    expect(payload.code).toBe("E-VIBECODR-0400");
    expect((env.DB as any).prepare).not.toHaveBeenCalled();
    expect(incrementPostStats).not.toHaveBeenCalled();
  });

  it("updates post stats on comment delete", async () => {
    (env.DB as any).first.mockResolvedValueOnce({
      comment_user_id: "u1",
      post_id: "p1",
      post_author_id: "u2",
    });
    (env.DB as any).run.mockResolvedValueOnce({});

    const res = await deleteComment(
      req("DELETE", "/comments/c1", "u1"),
      env as any,
      {} as any,
      { p1: "c1" } as any
    );

    expect(res.status).toBe(200);
    expect(incrementPostStats).toHaveBeenCalledWith(env, "p1", { commentsDelta: -1 });
  });
});
