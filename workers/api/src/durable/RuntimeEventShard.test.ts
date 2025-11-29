/// <reference types="vitest" />
import { describe, it, expect, vi } from "vitest";
import { RuntimeEventShard } from "./RuntimeEventShard";

const makeState = () =>
  ({
    id: { toString: () => "runtime-event-shard" },
    storage: { setAlarm: vi.fn().mockResolvedValue(undefined) },
  } as any);

describe("RuntimeEventShard", () => {
  it("flushes buffered events to D1 and analytics engine", async () => {
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
    const analytics = { writeDataPoint: vi.fn() };
    const shard = new RuntimeEventShard(state, { DB: db as any, vibecodr_analytics_engine: analytics } as any);

    await shard.fetch(
      new Request("https://do/runtime-events", {
        method: "POST",
        body: JSON.stringify({ id: "evt-1", event: "runtime_killed", timestampMs: 1000 }),
      }),
    );

    await shard.alarm();

    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(batchCalls[0]?.args?.[0]).toBe("evt-1");
    expect(analytics.writeDataPoint).toHaveBeenCalledTimes(1);
    expect(state.storage.setAlarm).toHaveBeenCalled();
  });
});
