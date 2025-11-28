import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRuntimeBudgetsForTest } from "@/components/Player/runtimeBudgets";
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

function resetBudgetsToDefaults() {
  setRuntimeBudgetsForTest("player", {
    maxConcurrentRunners: 2,
    clientStaticBootMs: 30_000,
    webContainerBootMs: 5_000,
    webContainerBootTargetMs: 5_000,
    webContainerBootHardKillMs: 30_000,
    runSessionMs: 60_000,
  });
  setRuntimeBudgetsForTest("feed", {
    maxConcurrentRunners: 2,
    clientStaticBootMs: 6_000,
    webContainerBootMs: 5_000,
    webContainerBootTargetMs: 5_000,
    webContainerBootHardKillMs: 12_000,
    runSessionMs: 6_000,
  });
  setRuntimeBudgetsForTest("embed", {
    maxConcurrentRunners: 2,
    clientStaticBootMs: 7_000,
    webContainerBootMs: 5_000,
    webContainerBootTargetMs: 5_000,
    webContainerBootHardKillMs: 30_000,
    runSessionMs: 30_000,
  });
}

describe("runtimeSession budgets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(loadRuntimeManifest).mockImplementation(() => new Promise(() => {}));
    resetBudgetsToDefaults();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
    vi.mocked(loadRuntimeManifest).mockReset();
    resetBudgetsToDefaults();
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

  it("applies runner-specific budget defaults from runtimeBudgets", () => {
    setRuntimeBudgetsForTest("player", {
      clientStaticBootMs: 9_000,
      webContainerBootHardKillMs: 15_000,
      runSessionMs: 45_000,
    });

    const webContainerSession = createRuntimeSession({
      artifactId: "artifact-webcontainer",
      surface: "player",
      runnerType: "webcontainer",
    });

    const clientSession = createRuntimeSession({
      artifactId: "artifact-client",
      surface: "player",
      runnerType: "client-static",
    });

    expect(webContainerSession.getBudgets()).toEqual({ bootMs: 15_000, runMs: 45_000 });
    expect(clientSession.getBudgets()).toEqual({ bootMs: 9_000, runMs: 45_000 });
  });
});
