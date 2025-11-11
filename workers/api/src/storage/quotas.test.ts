import { describe, it, expect } from "vitest";
import {
  Plan,
  PLAN_LIMITS,
  checkBundleSize,
  checkStorageQuota,
  checkRunQuota,
  formatBytes,
} from "./quotas";

describe("Quota Enforcement", () => {
  describe("PLAN_LIMITS", () => {
    it("should have limits for all plan tiers", () => {
      expect(PLAN_LIMITS[Plan.FREE]).toBeDefined();
      expect(PLAN_LIMITS[Plan.CREATOR]).toBeDefined();
      expect(PLAN_LIMITS[Plan.PRO]).toBeDefined();
      expect(PLAN_LIMITS[Plan.TEAM]).toBeDefined();
    });

    it("should have increasing limits across tiers", () => {
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

    it("should have correct FREE tier limits", () => {
      expect(PLAN_LIMITS[Plan.FREE].maxBundleSize).toBe(25 * 1024 * 1024); // 25 MB
      expect(PLAN_LIMITS[Plan.FREE].maxRuns).toBe(5_000);
      expect(PLAN_LIMITS[Plan.FREE].maxStorage).toBe(1 * 1024 * 1024 * 1024); // 1 GB
    });
  });

  describe("checkBundleSize", () => {
    it("should allow bundle within FREE tier limit", () => {
      const result = checkBundleSize(Plan.FREE, 20 * 1024 * 1024); // 20 MB
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should reject bundle exceeding FREE tier limit", () => {
      const result = checkBundleSize(Plan.FREE, 30 * 1024 * 1024); // 30 MB
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Bundle size exceeds");
    });

    it("should allow larger bundles on PRO tier", () => {
      const result = checkBundleSize(Plan.PRO, 80 * 1024 * 1024); // 80 MB
      expect(result.allowed).toBe(true);
    });

    it("should include percentUsed in result", () => {
      const result = checkBundleSize(Plan.FREE, 12.5 * 1024 * 1024); // 12.5 MB (50%)
      expect(result.percentUsed).toBe(50);
    });

    it("should include upgrade suggestion when exceeding", () => {
      const result = checkBundleSize(Plan.FREE, 30 * 1024 * 1024);
      expect(result.reason).toContain("PRO");
    });
  });

  describe("checkStorageQuota", () => {
    it("should allow storage within quota", () => {
      const currentUsage = 500 * 1024 * 1024; // 500 MB
      const additionalSize = 100 * 1024 * 1024; // 100 MB
      const result = checkStorageQuota(Plan.FREE, currentUsage, additionalSize);

      expect(result.allowed).toBe(true);
    });

    it("should reject storage exceeding quota", () => {
      const currentUsage = 950 * 1024 * 1024; // 950 MB
      const additionalSize = 100 * 1024 * 1024; // 100 MB
      const result = checkStorageQuota(Plan.FREE, currentUsage, additionalSize);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Storage quota exceeded");
    });

    it("should calculate correct percentUsed", () => {
      const currentUsage = 750 * 1024 * 1024; // 750 MB (75%)
      const result = checkStorageQuota(Plan.FREE, currentUsage, 0);

      expect(result.percentUsed).toBeCloseTo(75, 0);
    });
  });

  describe("checkRunQuota", () => {
    it("should allow runs within monthly quota", () => {
      const result = checkRunQuota(Plan.FREE, 3000); // 60% of 5000
      expect(result.allowed).toBe(true);
    });

    it("should reject runs exceeding monthly quota", () => {
      const result = checkRunQuota(Plan.FREE, 6000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Monthly run quota exceeded");
    });

    it("should calculate correct percentUsed", () => {
      const result = checkRunQuota(Plan.FREE, 2500); // 50%
      expect(result.percentUsed).toBe(50);
    });
  });

  describe("formatBytes", () => {
    it("should format bytes correctly", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    });

    it("should handle decimal values", () => {
      expect(formatBytes(1536)).toBe("1.5 KB"); // 1.5 KB
      expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
    });
  });
});
