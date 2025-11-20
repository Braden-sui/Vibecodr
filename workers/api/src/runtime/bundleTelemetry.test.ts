/// <reference types="vitest" />
import { describe, expect, it, vi } from "vitest";
import { recordBundleWarningMetrics } from "./bundleTelemetry";

const makeEnv = (analytics?: { writeDataPoint: (...args: any[]) => void }) => ({
  vibecodr_analytics_engine: analytics as any,
} as any);

describe("recordBundleWarningMetrics", () => {
  it("skips analytics when there are no warnings", () => {
    const analytics = { writeDataPoint: vi.fn() };
    recordBundleWarningMetrics(makeEnv(analytics), undefined, "test");
    expect(analytics.writeDataPoint).not.toHaveBeenCalled();
  });

  it("records analytics for bundle warnings only", () => {
    const analytics = { writeDataPoint: vi.fn() };
    recordBundleWarningMetrics(
      makeEnv(analytics),
      [
        { path: "bundle.0", message: "warning" },
        { path: "analysis.0", message: "info" },
        { path: "bundle.1", message: "second" },
      ],
      "capsulePublish"
    );
    expect(analytics.writeDataPoint).toHaveBeenCalledTimes(1);
    expect(analytics.writeDataPoint).toHaveBeenCalledWith({
      doubles: [2],
      indexes: ["capsulePublish"],
    });
  });

  it("logs and swallows analytics errors", () => {
    const analytics = {
      writeDataPoint: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    recordBundleWarningMetrics(
      makeEnv(analytics as any),
      [{ path: "bundle.0", message: "warning" }],
      "capsulePublish"
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
