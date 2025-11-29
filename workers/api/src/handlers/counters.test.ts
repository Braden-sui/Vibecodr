/// <reference types="vitest" />
import { describe, it, expect, vi } from "vitest";
import type { Env } from "../types";
import {
  incrementPostStats,
  incrementUserCounters,
  runCounterUpdate,
  ERROR_POST_STATS_UPDATE_FAILED,
} from "./counters";

const createEnv = (overrides: Partial<Env> = {}): Env =>
  ({
    DB: {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue(undefined),
    } as any,
    R2: {} as any,
    ALLOWLIST_HOSTS: "[]",
    ...overrides,
  } as any);

describe("incrementPostStats", () => {
  it("no-ops when all deltas are zero or undefined", async () => {
    const env = createEnv();
    await incrementPostStats(env, "p1", {});
    expect((env.DB as any).prepare).not.toHaveBeenCalled();
  });

  it("updates likes_count and comments_count with clamping", async () => {
    const env = createEnv();
    await incrementPostStats(env, "p1", { likesDelta: 1, commentsDelta: -2 });

    expect((env.DB as any).prepare).toHaveBeenCalledTimes(1);
    const sql = (env.DB as any).prepare.mock.calls[0][0] as string;
    expect(sql).toContain("likes_count");
    expect(sql).toContain("comments_count");
    expect(sql).toContain("UPDATE posts SET");

    const placeholderCount = (sql.match(/\?/g) ?? []).length;
    const bindArgs = (env.DB as any).bind.mock.calls[0];
    expect(placeholderCount).toBe(bindArgs.length);
    expect(bindArgs[0]).toBe(1);
    expect(bindArgs[1]).toBe(-2);
    expect(bindArgs[2]).toBe("p1");
  });

  it("rejects when the DB layer fails", async () => {
    const env = createEnv();
    (env.DB as any).run.mockRejectedValueOnce(new Error("boom"));

    await expect(incrementPostStats(env, "p1", { likesDelta: 1 })).rejects.toThrow("boom");
  });

  it("routes updates to the counter DO when available", async () => {
    const doFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      expect(payload.op).toBe("incrementPost");
      expect(payload.shadow).toBe(false);
      expect(payload.likesDelta).toBe(1);
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    });
    const env = createEnv({
      COUNTER_SHARD: {
        idFromName: vi.fn((n: any) => n),
        get: vi.fn(() => ({ fetch: doFetch })),
      } as any,
    });

    await incrementPostStats(env, "p-do", { likesDelta: 1 });

    expect(doFetch).toHaveBeenCalledTimes(1);
    expect((env.DB as any).prepare).not.toHaveBeenCalled();
  });
});

describe("incrementUserCounters", () => {
  it("binds match placeholders when updating multiple counters", async () => {
    const env = createEnv();
    await incrementUserCounters(env, "u1", { followersDelta: 2, runsDelta: -3 });

    expect((env.DB as any).prepare).toHaveBeenCalledTimes(1);
    const sql = (env.DB as any).prepare.mock.calls[0][0] as string;
    const placeholderCount = (sql.match(/\?/g) ?? []).length;
    const bindArgs = (env.DB as any).bind.mock.calls[0];
    expect(placeholderCount).toBe(bindArgs.length);
    expect(bindArgs).toEqual([2, -3, "u1"]);
  });

  it("falls back to DB when counter DO is in shadow mode", async () => {
    const doFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      expect(payload.shadow).toBe(true);
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    });
    const env = createEnv({
      COUNTER_DO_MODE: "shadow",
      COUNTER_SHARD: {
        idFromName: vi.fn((n: any) => n),
        get: vi.fn(() => ({ fetch: doFetch })),
      } as any,
    });

    await incrementUserCounters(env, "u-shadow", { runsDelta: 1 });

    expect(doFetch).toHaveBeenCalledTimes(1);
    expect((env.DB as any).prepare).toHaveBeenCalledTimes(1);
  });
});

describe("runCounterUpdate", () => {
  it("uses waitUntil and logs counter failures", async () => {
    const env = createEnv();
    (env.DB as any).run.mockRejectedValueOnce(new Error("boom"));
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
    const ctx = { waitUntil } as any;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runCounterUpdate(ctx, () => incrementPostStats(env, "p1", { likesDelta: 1 }), {
      code: ERROR_POST_STATS_UPDATE_FAILED,
      op: "test",
      details: { postId: "p1" },
    });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(spy).toHaveBeenCalledWith(
      `${ERROR_POST_STATS_UPDATE_FAILED} test failed`,
      expect.objectContaining({ postId: "p1", error: "boom" })
    );

    spy.mockRestore();
  });

  it("awaits updates when no context is provided", async () => {
    const env = createEnv();

    await runCounterUpdate(null, () => incrementPostStats(env, "p1", { likesDelta: 1 }), {
      code: ERROR_POST_STATS_UPDATE_FAILED,
      op: "no ctx",
    });

    expect((env.DB as any).prepare).toHaveBeenCalled();
  });
});
