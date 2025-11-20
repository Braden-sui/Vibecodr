/// <reference types="vitest" />
import { describe, it, expect, vi } from "vitest";
import type { Env } from "../index";
import { incrementPostStats, incrementUserCounters } from "./counters";

const createEnv = (): Env => ({
  DB: {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    run: vi.fn(),
  } as any,
  R2: {} as any,
  ALLOWLIST_HOSTS: "[]",
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

  it("logs and swallows errors from the DB layer", async () => {
    const env = createEnv();
    (env.DB as any).run.mockRejectedValueOnce(new Error("boom"));

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await incrementPostStats(env, "p1", { likesDelta: 1 });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
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
});
