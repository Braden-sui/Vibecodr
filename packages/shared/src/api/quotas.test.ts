import { describe, expect, it } from "vitest";
import { Plan } from "../plans";
import { UserQuotaResponseSchema } from "./quotas";

describe("UserQuotaResponseSchema", () => {
  it("parses a full quota payload", () => {
    const payload = {
      plan: Plan.FREE,
      usage: {
        storage: 500 * 1024 * 1024,
        runs: 2_500,
        bundleSize: 10 * 1024 * 1024,
        liveMinutes: 0,
      },
      limits: {
        maxStorage: 1 * 1024 * 1024 * 1024,
        maxRuns: 5_000,
        maxBundleSize: 25 * 1024 * 1024,
        liveMinutes: 0,
      },
      percentUsed: {
        storage: 50,
        runs: 50,
      },
    };

    expect(UserQuotaResponseSchema.parse(payload)).toEqual(payload);
  });

  it("rejects negative usage values", () => {
    const payload = {
      plan: Plan.PRO,
      usage: {
        storage: -1,
        runs: 0,
        bundleSize: 0,
        liveMinutes: 0,
      },
      limits: {
        maxStorage: 1,
        maxRuns: 1,
        maxBundleSize: 1,
        liveMinutes: 0,
      },
    };

    expect(() => UserQuotaResponseSchema.parse(payload)).toThrow();
  });
});
