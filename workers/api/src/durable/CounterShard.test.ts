/// <reference types="vitest" />
import { describe, it, expect, vi } from "vitest";
import { CounterShard } from "./CounterShard";

const makeState = () =>
  ({
    id: { toString: () => "counter-shard" },
    storage: { setAlarm: vi.fn().mockResolvedValue(undefined) },
  } as any);

describe("CounterShard", () => {
  it("batches increments and flushes to D1", async () => {
    const state = makeState();
    const batchCalls: any[] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        sql,
        bind: (...args: any[]) => ({ sql, args }),
      })),
      batch: vi.fn(async (stmts: any[]) => {
        batchCalls.push(...stmts);
      }),
    };

    const shard = new CounterShard(state, { DB: db as any } as any);
    await shard.fetch(
      new Request("https://do/counter", {
        method: "POST",
        body: JSON.stringify({ op: "incrementPost", postId: "post-1", likesDelta: 2, runsDelta: 1 }),
      }),
    );

    await shard.alarm();

    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(batchCalls[0]?.args?.slice(0, 2)).toEqual([2, 1]);
    expect(batchCalls[0]?.args?.at(-1)).toBe("post-1");
  });

  it("acknowledges shadow-mode increments without persisting", async () => {
    const state = makeState();
    const db = {
      prepare: vi.fn(),
      batch: vi.fn(),
    };
    const shard = new CounterShard(state, { DB: db as any } as any);

    const res = await shard.fetch(
      new Request("https://do/counter", {
        method: "POST",
        body: JSON.stringify({ op: "incrementUser", userId: "user-1", runsDelta: 1, shadow: true }),
      }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ shadow: true });
    await shard.alarm();
    expect(db.batch).not.toHaveBeenCalled();
  });
});
