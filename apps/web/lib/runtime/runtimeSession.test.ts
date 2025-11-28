import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeSession } from "./runtimeSession";
import { loadRuntimeManifest } from "./loadRuntimeManifest";

vi.mock("./loadRuntimeManifest", () => ({
  loadRuntimeManifest: vi.fn(() => new Promise(() => {})),
}));

const resolvedManifest = {
  artifactId: "artifact-boot",
  runtimeVersion: "1.0.0",
  type: "client-static",
};

describe("runtimeSession budgets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(loadRuntimeManifest).mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
    vi.mocked(loadRuntimeManifest).mockReset();
  });

  it("emits boot_timeout and transitions to error when boot budget is exceeded", () => {
    const logger = vi.fn();
    const session = createRuntimeSession({
      artifactId: "artifact-timeout",
      surface: "feed",
      maxBootMs: 50,
      maxRunMs: 1_000,
      logger,
    });

    session.start();
    vi.advanceTimersByTime(60);

    expect(logger).toHaveBeenCalledWith({ type: "boot_timeout", durationMs: 50 });
    expect(session.getState().status).toBe("error");
    expect(session.getState().error).toContain("Runtime did not start");
  });

  it("emits run_timeout and transitions to error when run budget is exceeded", async () => {
    vi.mocked(loadRuntimeManifest).mockResolvedValueOnce(resolvedManifest as any);
    const logger = vi.fn();
    const session = createRuntimeSession({
      artifactId: "artifact-run-timeout",
      surface: "feed",
      maxBootMs: 1_000,
      maxRunMs: 40,
      logger,
    });

    session.start();
    await Promise.resolve();
    vi.advanceTimersByTime(45);

    expect(logger).toHaveBeenCalledWith({ type: "run_timeout", durationMs: 40 });
    expect(session.getState().status).toBe("error");
    expect(session.getState().error).toBe("Runtime session timed out.");
  });
});
