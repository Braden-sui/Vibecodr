import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, Plan, PlanSchema, normalizePlan } from "./plans";

describe("PlanSchema", () => {
  it("accepts all known plan slugs", () => {
    for (const plan of Object.values(Plan)) {
      expect(PlanSchema.parse(plan)).toBe(plan);
    }
  });

  it("rejects unknown plan values", () => {
    expect(() => PlanSchema.parse("enterprise")).toThrow();
  });
});

describe("normalizePlan", () => {
  it("defaults to free when value is missing", () => {
    expect(normalizePlan(undefined)).toBe(Plan.FREE);
  });

  it("parses case-insensitive values", () => {
    expect(normalizePlan("Pro")).toBe(Plan.PRO);
    expect(normalizePlan("TEAM")).toBe(Plan.TEAM);
  });
});

describe("PLAN_LIMITS", () => {
  it("provides limits for every plan", () => {
    for (const plan of Object.values(Plan)) {
      expect(PLAN_LIMITS[plan]).toBeDefined();
    }
  });

  it("enforces monotonic increases for bundle size across paid plans", () => {
    expect(PLAN_LIMITS[Plan.CREATOR].maxBundleSize).toBeGreaterThanOrEqual(
      PLAN_LIMITS[Plan.FREE].maxBundleSize
    );
    expect(PLAN_LIMITS[Plan.PRO].maxBundleSize).toBeGreaterThan(
      PLAN_LIMITS[Plan.CREATOR].maxBundleSize
    );
    expect(PLAN_LIMITS[Plan.TEAM].maxBundleSize).toBeGreaterThan(
      PLAN_LIMITS[Plan.PRO].maxBundleSize
    );
  });
});
