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
  incrementUserCounters: vi.fn(async () => {}),
  incrementPostStats: vi.fn(async () => {}),
}));

import { incrementUserCounters, incrementPostStats } from "./counters";
import { followUser, unfollowUser, likePost, unlikePost, createComment, deleteComment } from "./social";

const createEnv = (): Env => ({
  DB: {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
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

  it("increments counters on follow", async () => {
    // user exists
    (env.DB as any).first.mockResolvedValueOnce({ id: "u2" });
    // insert follows
    ;(env.DB as any).run.mockResolvedValueOnce({});
    ;(env.DB as any).run.mockResolvedValueOnce({}); // notification

    const res = await followUser(req("POST", "/users/u2/follow"), env as any, {} as any, { p1: "u2" } as any);
    expect(res.status).toBe(200);

    expect(incrementUserCounters).toHaveBeenCalledWith(env, "u2", { followersDelta: 1 });
    expect(incrementUserCounters).toHaveBeenCalledWith(env, "u1", { followingDelta: 1 });
  });

  it("decrements counters on unfollow", async () => {
    // delete follows
    ;(env.DB as any).run.mockResolvedValueOnce({});

    const res = await unfollowUser(req("DELETE", "/users/u2/follow"), env as any, {} as any, { p1: "u2" } as any);
    expect(res.status).toBe(200);

    expect(incrementUserCounters).toHaveBeenCalledWith(env, "u2", { followersDelta: -1 });
    expect(incrementUserCounters).toHaveBeenCalledWith(env, "u1", { followingDelta: -1 });
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
