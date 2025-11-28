/**
 * Runtime Budget Guardrails for runtime surfaces
 *
 * INVARIANT: The number of active slots must never exceed maxConcurrentRunners for the requesting surface.
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
 * | runSessionMs                 | KILL        | Terminate session after threshold           |
 *
 * ## Deprecated/Redundant Fields
 *
 * - `webContainerBootMs`: DEPRECATED - use webContainerBootTargetMs for warn, webContainerBootHardKillMs for kill
 */

export type BudgetEnforcement = "cap" | "warn" | "kill";

import type { RuntimeSurface } from "@/lib/runtime/runtimeSession";

type SurfaceBudgets = {
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

type RuntimeBudgetsConfig = Record<RuntimeSurface, SurfaceBudgets>;

/**
 * Default budget values.
 *
 * SOTP Decision: 30s hard kill for client-static player; WebContainer warn stays at 5s but hard kill matches 30s cap.
 * Feed defaults are more aggressive (6s boot/run) to protect scrolling UX; embed mirrors player boot but shorter run cap.
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
  player: {
    maxConcurrentRunners: 2,
    clientStaticBootMs: 30_000,
    webContainerBootMs: 5_000,
    webContainerBootTargetMs: 5_000,
    webContainerBootHardKillMs: 30_000,
    runSessionMs: 60_000,
  },
  feed: {
    maxConcurrentRunners: 2,
    clientStaticBootMs: 6_000,
    webContainerBootMs: 5_000,
    webContainerBootTargetMs: 5_000,
    webContainerBootHardKillMs: 12_000,
    runSessionMs: 6_000,
  },
  embed: {
    maxConcurrentRunners: 2,
    clientStaticBootMs: 7_000,
    webContainerBootMs: 5_000,
    webContainerBootTargetMs: 5_000,
    webContainerBootHardKillMs: 30_000,
    runSessionMs: 30_000,
  },
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
  const maxConcurrent = readEnvNumber("VIBECODR_RUNTIME_MAX_CONCURRENT");
  const bootMs = readEnvNumber("VIBECODR_RUNTIME_BOOT_MS");
  const webContainerBootMs = readEnvNumber("VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_MS");
  const webContainerBootTargetMs = readEnvNumber("VIBECODR_RUNTIME_WEB_CONTAINER_BOOT_TARGET_MS");
  const webContainerBootHardKillMs = readEnvNumber("VIBECODR_RUNTIME_WEB_CONTAINER_HARD_KILL_MS");
  const runMs = readEnvNumber("VIBECODR_RUNTIME_SESSION_MS");

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Math.trunc(value), min), max);

  const applyOverrides = (defaults: SurfaceBudgets): SurfaceBudgets => ({
    maxConcurrentRunners: clamp(maxConcurrent ?? defaults.maxConcurrentRunners, 1, 10),
    clientStaticBootMs: clamp(bootMs ?? defaults.clientStaticBootMs, 100, 120_000),
    webContainerBootMs: clamp(webContainerBootMs ?? defaults.webContainerBootMs, 100, 120_000),
    webContainerBootTargetMs: clamp(webContainerBootTargetMs ?? defaults.webContainerBootTargetMs, 100, 120_000),
    webContainerBootHardKillMs: clamp(webContainerBootHardKillMs ?? defaults.webContainerBootHardKillMs, 100, 120_000),
    runSessionMs: clamp(runMs ?? defaults.runSessionMs, 1_000, 300_000),
  });

  return {
    player: applyOverrides(DEFAULT_BUDGETS.player),
    feed: applyOverrides(DEFAULT_BUDGETS.feed),
    embed: applyOverrides(DEFAULT_BUDGETS.embed),
  };
})();

export function getRuntimeBudgets(surface: RuntimeSurface): SurfaceBudgets {
  return runtimeBudgetsConfig[surface];
}

type SlotKey = string | symbol;

const activeSlots = new Set<SlotKey>();

export type RuntimeSlotReservation = {
  surface: RuntimeSurface;
  token: symbol;
  allowed: boolean;
  activeCount: number;
  limit: number;
};

export type RuntimeSlotConfirmation = {
  allowed: boolean;
  activeCount: number;
  limit: number;
  token: SlotKey;
};

export function reserveRuntimeSlot(surface: RuntimeSurface): RuntimeSlotReservation {
  const limits = getRuntimeBudgets(surface);
  const token = Symbol("runtime-slot");
  const allowed = activeSlots.size < limits.maxConcurrentRunners;

  if (allowed) {
    activeSlots.add(token);
  }

  return {
    surface,
    token,
    allowed,
    activeCount: activeSlots.size,
    limit: limits.maxConcurrentRunners,
  };
}

export function confirmRuntimeSlot(surface: RuntimeSurface, token: SlotKey, runId: string): RuntimeSlotConfirmation {
  const limits = getRuntimeBudgets(surface);
  if (activeSlots.has(token)) {
    activeSlots.delete(token);
  } else if (activeSlots.size >= limits.maxConcurrentRunners) {
    return {
      allowed: false,
      activeCount: activeSlots.size,
      limit: limits.maxConcurrentRunners,
      token,
    };
  }

  activeSlots.add(runId);
  return {
    allowed: true,
    activeCount: activeSlots.size,
    limit: limits.maxConcurrentRunners,
    token: runId,
  };
}

export function releaseRuntimeSlot(slot?: SlotKey | null, _surface?: RuntimeSurface): number {
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
export function setRuntimeBudgetsForTest(surface: RuntimeSurface, config: Partial<SurfaceBudgets>) {
  runtimeBudgetsConfig = {
    ...runtimeBudgetsConfig,
    [surface]: {
      ...runtimeBudgetsConfig[surface],
      ...config,
    },
  };
}
