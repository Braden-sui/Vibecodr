/// <reference types="vitest" />
import { describe, it, expect, vi } from "vitest";
import { checkPublicRateLimit } from "./rateLimit";
import type { Env } from "./types";

type Row = { count: number; reset_at: number };

function createEnv() {
  const table = new Map<string, Row>();

  const prepare = vi.fn((sql: string) => {
    const stmt: any = {
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async first() {
        if (sql.includes("SELECT count, reset_at")) {
          const row = table.get(this.bindArgs[0]);
          return row ? { ...row } : undefined;
        }
        return undefined;
      },
      async run() {
        if (sql.startsWith("CREATE TABLE IF NOT EXISTS")) {
          return { meta: { changes: 0 } };
        }
        if (sql.startsWith("INSERT INTO public_rate_limits")) {
          const [key, resetAt] = this.bindArgs;
          table.set(key, { count: 1, reset_at: resetAt });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE public_rate_limits SET count = ? WHERE key = ?")) {
          const [count, key] = this.bindArgs;
          const existing = table.get(key);
          if (existing) {
            table.set(key, { ...existing, count });
          }
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
    };
    return stmt;
  });

  return {
    DB: { prepare } as any,
    table,
  } as unknown as Env & { table: Map<string, Row> };
}

describe("checkPublicRateLimit", () => {
  it("allows first request and tracks remaining", async () => {
    const env = createEnv();
    const key = "ip:1.1.1.1";

    const result = await checkPublicRateLimit(env, key, 2, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it("blocks after exceeding limit within window", async () => {
    const env = createEnv();
    const key = "ip:1.1.1.1";

    await checkPublicRateLimit(env, key, 1, 60);
    const second = await checkPublicRateLimit(env, key, 1, 60);
    expect(second.allowed).toBe(false);
    expect(second.remaining).toBe(0);
  });
});
