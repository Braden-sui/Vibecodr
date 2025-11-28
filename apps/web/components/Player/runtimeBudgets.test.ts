import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeRuntimeSlots,
  confirmRuntimeSlot,
  getRuntimeBudgets,
  releaseRuntimeSlot,
  reserveRuntimeSlot,
  resetRuntimeSlotsForTest,
  setRuntimeBudgetsForTest,
} from "./runtimeBudgets";

describe("runtimeBudgets", () => {
  beforeEach(() => {
    resetRuntimeSlotsForTest();
    setRuntimeBudgetsForTest("player", {
      maxConcurrentRunners: 2,
      clientStaticBootMs: 5_000,
      webContainerBootMs: 8_000,
      runSessionMs: 60_000,
      webContainerBootTargetMs: 5_000,
      webContainerBootHardKillMs: 30_000,
    });
    setRuntimeBudgetsForTest("feed", {
      maxConcurrentRunners: 2,
      clientStaticBootMs: 6_000,
      webContainerBootMs: 5_000,
      webContainerBootTargetMs: 5_000,
      webContainerBootHardKillMs: 12_000,
      runSessionMs: 6_000,
    });
  });

  afterEach(() => {
    resetRuntimeSlotsForTest();
  });

  it("reserves a slot when under the limit and promotes it to a run id", () => {
    const reservation = reserveRuntimeSlot("player");
    expect(reservation.allowed).toBe(true);
    expect(activeRuntimeSlots()).toBe(1);

    const confirmation = confirmRuntimeSlot("player", reservation.token, "run-1");
    expect(confirmation.allowed).toBe(true);
    expect(activeRuntimeSlots()).toBe(1);

    releaseRuntimeSlot("run-1");
    expect(activeRuntimeSlots()).toBe(0);
  });

  it("rejects reservations when the concurrent limit is reached", () => {
    const reservations = Array.from({ length: getRuntimeBudgets("player").maxConcurrentRunners }, () =>
      reserveRuntimeSlot("player")
    );
    for (const r of reservations) {
      expect(r.allowed).toBe(true);
    }
    expect(activeRuntimeSlots()).toBe(getRuntimeBudgets("player").maxConcurrentRunners);

    const denied = reserveRuntimeSlot("player");
    expect(denied.allowed).toBe(false);
    expect(activeRuntimeSlots()).toBe(getRuntimeBudgets("player").maxConcurrentRunners);
  });

  it("fails confirmation when the limit is exceeded without a reservation", () => {
    const reservations = Array.from({ length: getRuntimeBudgets("player").maxConcurrentRunners }, () =>
      reserveRuntimeSlot("player")
    );
    for (const r of reservations) {
      confirmRuntimeSlot("player", r.token, `run-${String(Math.random())}`);
    }

    const confirmation = confirmRuntimeSlot("player", Symbol("orphan"), "run-over");
    expect(confirmation.allowed).toBe(false);
    expect(activeRuntimeSlots()).toBe(getRuntimeBudgets("player").maxConcurrentRunners);
  });

  it("allows test overrides for budgets", () => {
    setRuntimeBudgetsForTest("player", { maxConcurrentRunners: 3, webContainerBootMs: 4_500 });
    expect(getRuntimeBudgets("player").maxConcurrentRunners).toBe(3);
    expect(getRuntimeBudgets("player").webContainerBootMs).toBe(4_500);
  });

  it("keeps per-surface budgets isolated", () => {
    resetRuntimeSlotsForTest();
    setRuntimeBudgetsForTest("feed", { clientStaticBootMs: 7_500, maxConcurrentRunners: 1 });
    expect(getRuntimeBudgets("feed").runSessionMs).toBeLessThan(getRuntimeBudgets("player").runSessionMs);
    expect(getRuntimeBudgets("feed").clientStaticBootMs).toBe(7_500);
    expect(getRuntimeBudgets("player").clientStaticBootMs).toBe(5_000);
    expect(getRuntimeBudgets("feed").maxConcurrentRunners).toBe(1);
    expect(getRuntimeBudgets("player").maxConcurrentRunners).toBe(2);
  });
});
