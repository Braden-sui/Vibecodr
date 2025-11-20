import { describe, it, expect } from "vitest";
import { computeForYouScore, routes, type ForYouScoreInput } from "./index";
import { appendRunLogs } from "./handlers/runs";

describe("computeForYouScore", () => {
  it("gives higher score to posts with capsules under similar stats", () => {
    const nowSec = 1_700_000_000;

    const base: ForYouScoreInput = {
      createdAtSec: nowSec - 3600,
      nowSec,
      stats: { runs: 10, likes: 5, remixes: 1 },
      authorFollowers: 100,
      authorIsFeatured: false,
      authorPlan: "free",
      hasCapsule: false,
    };

    const withoutCapsule = computeForYouScore(base);
    const withCapsule = computeForYouScore({ ...base, hasCapsule: true });

    expect(withCapsule).toBeGreaterThan(withoutCapsule);
    expect(withCapsule - withoutCapsule).toBeCloseTo(0.1, 5);
  });
});

describe("routes", () => {
  it("matches hyphenated run IDs for appendRunLogs", () => {
    const route = routes.find((r) => r.method === "POST" && r.handler === appendRunLogs);
    expect(route).toBeDefined();
    expect(route?.pattern.test("/runs/run-123/logs")).toBe(true);
    expect(route?.pattern.test("/runs/run_123/logs")).toBe(true);
    expect(route?.pattern.test("/runs/run-123/invalid/logs")).toBe(false);
  });
});
