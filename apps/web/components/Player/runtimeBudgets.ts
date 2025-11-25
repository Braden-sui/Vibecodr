/**
 * Runtime Budget Guardrails for Player Surfaces
 *
 * INVARIANT: The number of active slots must never exceed maxConcurrentRunners.
 *
 * ## Budget Semantics
 *
 * Each budget field has one of three enforcement behaviors:
 * - **CAP**: Rejects/blocks action before it starts
 * - **WARN**: Logs warning + telemetry, action continues
 * - **KILL**: Terminates running action after threshold
 *
 * | Field                        | Enforcement | Behavior                                    |
 * |------------------------------|-------------|---------------------------------------------|
 * | maxConcurrentRunners         | CAP         | Blocks new runtime if limit reached         |
 * | clientStaticBootMs           | KILL        | Hard kill iframe if boot exceeds threshold  |
 * | webContainerBootTargetMs     | WARN        | Log warning if boot exceeds p95 target      |
 * | webContainerBootHardKillMs   | KILL        | Hard kill iframe if boot exceeds threshold  |
 * | runSessionMs                 | KILL (TODO) | Should terminate session after threshold    |
 *
 * ## Deprecated/Redundant Fields
 *
 * - `webContainerBootMs`: DEPRECATED - use webContainerBootTargetMs for warn, webContainerBootHardKillMs for kill
 */

export type BudgetEnforcement = "cap" | "warn" | "kill";

type RuntimeBudgetsConfig = {
  /**
   * Maximum concurrent runtime iframes allowed.
   * @enforcement CAP - reserveRuntimeSlot() returns allowed=false if exceeded
   * @default 2
   */
  maxConcurrentRunners: number;

  /**
   * Hard kill timeout for client-static (react-jsx, html) runtimes.
   * @enforcement KILL - iframe navigated to about:blank, error shown to user
   * @default 30000
   */
  clientStaticBootMs: number;

  /**
   * @deprecated Use webContainerBootTargetMs (warn) or webContainerBootHardKillMs (kill)
   * Kept for backward compatibility with env var VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_MS
   */
  webContainerBootMs: number;

  /**
   * Soft warning threshold for WebContainer boot (p95 target).
   * @enforcement WARN - console.warn + telemetry event, no user-visible action
   * @default 5000
   */
  webContainerBootTargetMs: number;

  /**
   * Hard kill timeout for WebContainer boot.
   * @enforcement KILL - iframe navigated to about:blank, error shown to user
   * @default 30000
   */
  webContainerBootHardKillMs: number;

  /**
   * Maximum session duration for a running capsule.
   * @enforcement KILL (TODO - not yet implemented)
   * @default 60000
   */
  runSessionMs: number;
};

/**
 * Default budget values.
 *
 * SOTP Decision: 30s hard kill for client-static; WebContainer warn stays at 5s but hard kill matches 30s cap.
 *
 * These can be overridden via environment variables:
 * - VIBECODR_RUNTIME_MAX_CONCURRENT
 * - VIBECODR_RUNTIME_BOOT_MS (clientStaticBootMs)
 * - VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_MS (deprecated, use TARGET or HARD_KILL)
 * - VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_TARGET_MS
 * - VIBECODR_RUNTIME_WEB_CONTAINER_HARD_KILL_MS
 * - VIBECODR_RUNTIME_SESSION_MS
 */
const DEFAULT_BUDGETS: RuntimeBudgetsConfig = {
  // CAP: Blocks new runtimes if exceeded
  maxConcurrentRunners: 2,

  // KILL: Hard kill for client-static runtimes
  clientStaticBootMs: 30_000,

  // DEPRECATED: Use webContainerBootTargetMs or webContainerBootHardKillMs
  webContainerBootMs: 5_000,

  // WARN: Log warning if exceeded (p95 target)
  webContainerBootTargetMs: 5_000,

  // KILL: Hard kill for WebContainer runtimes
  webContainerBootHardKillMs: 30_000,

  // KILL (TODO): Should terminate session after threshold
  runSessionMs: 60_000,
};

type ImportMetaEnvShape = Record<string, string | undefined>;

function readImportMetaEnv(): ImportMetaEnvShape | null {
  if (typeof import.meta === "undefined") {
    return null;
  }
  const meta: unknown = import.meta;
  if (meta && typeof meta === "object" && "env" in meta) {
    const env = (meta as { env?: unknown }).env;
    if (env && typeof env === "object") {
      return env as ImportMetaEnvShape;
    }
  }
  return null;
}

function readEnvNumber(key: string): number | null {
  const fromImportMeta = readImportMetaEnv()?.[key];
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
  const webContainerBootMs =
    readEnvNumber("VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_MS") ?? DEFAULT_BUDGETS.webContainerBootMs;
  const webContainerBootTargetMs =
    readEnvNumber("VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_TARGET_MS") ?? DEFAULT_BUDGETS.webContainerBootTargetMs;
  const webContainerBootHardKillMs =
    readEnvNumber("VIBECODR_RUNTIME_WEB_CONTAINER_HARD_KILL_MS") ?? DEFAULT_BUDGETS.webContainerBootHardKillMs;
  const runMs = readEnvNumber("VIBECODR_RUNTIME_SESSION_MS") ?? DEFAULT_BUDGETS.runSessionMs;

  return {
    maxConcurrentRunners: Math.min(Math.max(Math.trunc(maxConcurrent), 1), 10),
    clientStaticBootMs: Math.min(Math.max(Math.trunc(bootMs), 100), 120_000),
    webContainerBootMs: Math.min(Math.max(Math.trunc(webContainerBootMs), 100), 120_000),
    webContainerBootTargetMs: Math.min(Math.max(Math.trunc(webContainerBootTargetMs), 100), 120_000),
    webContainerBootHardKillMs: Math.min(Math.max(Math.trunc(webContainerBootHardKillMs), 100), 120_000),
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
