/// <reference types="vitest" />
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Env } from "../index";

vi.mock("./counters", () => ({
  incrementUserCounters: vi.fn(async () => {}),
  incrementPostStats: vi.fn(async () => {}),
}));

import { incrementUserCounters, incrementPostStats } from "./counters";
import { followUser, unfollowUser, likePost, unlikePost } from "./social";

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

function req(method: string, url: string, authUser: string | null = "u1") {
  return new Request("https://api.example" + url, {
    method,
    headers: authUser ? { Authorization: `Bearer ${authUser}` } : {},
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
});
