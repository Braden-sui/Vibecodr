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
    setRuntimeBudgetsForTest({ maxConcurrentRunners: 2, clientStaticBootMs: 5_000, runSessionMs: 60_000 });
  });

  afterEach(() => {
    resetRuntimeSlotsForTest();
  });

  it("reserves a slot when under the limit and promotes it to a run id", () => {
    const reservation = reserveRuntimeSlot();
    expect(reservation.allowed).toBe(true);
    expect(activeRuntimeSlots()).toBe(1);

    const confirmation = confirmRuntimeSlot(reservation.token, "run-1");
    expect(confirmation.allowed).toBe(true);
    expect(activeRuntimeSlots()).toBe(1);

    releaseRuntimeSlot("run-1");
    expect(activeRuntimeSlots()).toBe(0);
  });

  it("rejects reservations when the concurrent limit is reached", () => {
    const reservations = Array.from({ length: getRuntimeBudgets().maxConcurrentRunners }, () =>
      reserveRuntimeSlot()
    );
    for (const r of reservations) {
      expect(r.allowed).toBe(true);
    }
    expect(activeRuntimeSlots()).toBe(getRuntimeBudgets().maxConcurrentRunners);

    const denied = reserveRuntimeSlot();
    expect(denied.allowed).toBe(false);
    expect(activeRuntimeSlots()).toBe(getRuntimeBudgets().maxConcurrentRunners);
  });

  it("fails confirmation when the limit is exceeded without a reservation", () => {
    const reservations = Array.from({ length: getRuntimeBudgets().maxConcurrentRunners }, () =>
      reserveRuntimeSlot()
    );
    for (const r of reservations) {
      confirmRuntimeSlot(r.token, `run-${String(Math.random())}`);
    }

    const confirmation = confirmRuntimeSlot(Symbol("orphan"), "run-over");
    expect(confirmation.allowed).toBe(false);
    expect(activeRuntimeSlots()).toBe(getRuntimeBudgets().maxConcurrentRunners);
  });

  it("allows test overrides for budgets", () => {
    setRuntimeBudgetsForTest({ maxConcurrentRunners: 3 });
    expect(getRuntimeBudgets().maxConcurrentRunners).toBe(3);
  });
});
