// Runtime budget guardrails for the Player surfaces.
// INVARIANT: The number of active slots must never exceed maxConcurrentRunners.

type RuntimeBudgetsConfig = {
  maxConcurrentRunners: number;
  clientStaticBootMs: number;
  runSessionMs: number;
};

const DEFAULT_BUDGETS: RuntimeBudgetsConfig = {
  maxConcurrentRunners: 2,
  clientStaticBootMs: 5_000,
  runSessionMs: 60_000,
};

function readEnvNumber(key: string): number | null {
  const fromImportMeta =
    typeof import.meta !== "undefined" && (import.meta as any).env
      ? (import.meta as any).env[key]
      : undefined;
  const fromProcess =
    typeof process !== "undefined" && process.env ? process.env[key] : undefined;
  const raw = fromImportMeta ?? fromProcess;
  if (raw === undefined || raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

let runtimeBudgetsConfig: RuntimeBudgetsConfig = (() => {
  const maxConcurrent = readEnvNumber("VIBECODR_RUNTIME_MAX_CONCURRENT") ?? DEFAULT_BUDGETS.maxConcurrentRunners;
  const bootMs = readEnvNumber("VIBECODR_RUNTIME_BOOT_MS") ?? DEFAULT_BUDGETS.clientStaticBootMs;
  const runMs = readEnvNumber("VIBECODR_RUNTIME_SESSION_MS") ?? DEFAULT_BUDGETS.runSessionMs;

  return {
    maxConcurrentRunners: Math.min(Math.max(Math.trunc(maxConcurrent), 1), 10),
    clientStaticBootMs: Math.min(Math.max(Math.trunc(bootMs), 100), 120_000),
    runSessionMs: Math.min(Math.max(Math.trunc(runMs), 1_000), 300_000),
  };
})();

export function getRuntimeBudgets(): RuntimeBudgetsConfig {
  return runtimeBudgetsConfig;
}

type SlotKey = string | symbol;

const activeSlots = new Set<SlotKey>();

export type RuntimeSlotReservation = {
  token: symbol;
  allowed: boolean;
  activeCount: number;
  limit: number;
};

export type RuntimeSlotConfirmation = {
  allowed: boolean;
  activeCount: number;
  limit: number;
};

export function reserveRuntimeSlot(): RuntimeSlotReservation {
  const limits = getRuntimeBudgets();
  const token = Symbol("runtime-slot");
  const allowed = activeSlots.size < limits.maxConcurrentRunners;

  if (allowed) {
    activeSlots.add(token);
  }

  return {
    token,
    allowed,
    activeCount: activeSlots.size,
    limit: limits.maxConcurrentRunners,
  };
}

export function confirmRuntimeSlot(token: SlotKey, runId: string): RuntimeSlotConfirmation {
  const limits = getRuntimeBudgets();
  if (activeSlots.has(token)) {
    activeSlots.delete(token);
  } else if (activeSlots.size >= limits.maxConcurrentRunners) {
    return {
      allowed: false,
      activeCount: activeSlots.size,
      limit: limits.maxConcurrentRunners,
    };
  }

  activeSlots.add(runId);
  return {
    allowed: true,
    activeCount: activeSlots.size,
    limit: limits.maxConcurrentRunners,
  };
}

export function releaseRuntimeSlot(slot?: SlotKey | null): number {
  if (slot && activeSlots.has(slot)) {
    activeSlots.delete(slot);
  }
  return activeSlots.size;
}

export function activeRuntimeSlots(): number {
  return activeSlots.size;
}

// WHY: Tests need deterministic state between runs.
export function resetRuntimeSlotsForTest() {
  activeSlots.clear();
}

// WHY: Tests override budgets without relying on env mutation.
export function setRuntimeBudgetsForTest(config: Partial<RuntimeBudgetsConfig>) {
  runtimeBudgetsConfig = {
    ...runtimeBudgetsConfig,
    ...config,
  };
}
