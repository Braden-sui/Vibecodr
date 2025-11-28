"use client";

import { loadRuntimeManifest, type ClientRuntimeManifest } from "./loadRuntimeManifest";

export const RUNTIME_TELEMETRY_LIMIT = 120;

export type RuntimeSurface = "player" | "feed" | "embed";

export type RuntimeSessionStatus = "idle" | "loading" | "ready" | "error";

export type RuntimeSessionConfig = {
  artifactId: string;
  capsuleId?: string;
  bundleUrl?: string;
  params?: Record<string, unknown>;
  surface: RuntimeSurface;
  autoStart?: boolean;
  maxBootMs?: number;
  maxRunMs?: number;
  telemetryEmitter?: (event: string, payload: RuntimeTelemetryPayload) => void;
  telemetryLimit?: number;
  logger?: (event: RuntimeEvent) => void;
};

export type RuntimeEvent =
  | { type: "state"; status: RuntimeSessionStatus; error?: string | null }
  | { type: "manifest_loaded"; artifactId: string; runtimeVersion: string; runtimeType: string }
  | { type: "boot_timeout"; durationMs: number }
  | { type: "run_timeout"; durationMs: number };

export type RuntimeSessionState = {
  status: RuntimeSessionStatus;
  error: string | null;
  manifest: ClientRuntimeManifest | null;
  runId: string;
  budgets: RuntimeBudgets;
};

type Subscriber = (state: RuntimeSessionState) => void;

export interface RuntimeSession {
  getState(): RuntimeSessionState;
  subscribe(listener: Subscriber): () => void;
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
  setParams(params: Record<string, unknown> | undefined): void;
  markReady(): void;
  markError(message: string): void;
  emitTelemetry(event: string, payload?: Record<string, unknown>): void;
  getBudgets(): RuntimeBudgets;
}

export type RuntimeBudgets = {
  bootMs: number;
  runMs: number;
};

export type RuntimeTelemetryPayload = {
  surface: RuntimeSurface;
  runId: string;
  artifactId: string | null;
  capsuleId: string | null;
  bundleUrl: string | null;
  budgets: RuntimeBudgets;
} & Record<string, unknown>;

function defaultBootBudget(surface: RuntimeSurface): number {
  if (surface === "feed") return 6_000;
  if (surface === "embed") return 7_000;
  return 30_000; // player can be slightly more lenient
}

function defaultRunBudget(surface: RuntimeSurface): number {
  if (surface === "feed") return 6_000;
  if (surface === "embed") return 30_000;
  return 120_000; // player
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRuntimeSession(config: RuntimeSessionConfig): RuntimeSession {
  const subscribers = new Set<Subscriber>();
  let paramsRef = config.params;
  let bootTimer: ReturnType<typeof setTimeout> | null = null;
  let runTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let bootStartedAt: number | null = null;
  let telemetryCount = 0;
  let telemetryCapped = false;

  const budgets: RuntimeBudgets = {
    bootMs: config.maxBootMs ?? defaultBootBudget(config.surface),
    runMs: config.maxRunMs ?? defaultRunBudget(config.surface),
  };

  const state: RuntimeSessionState = {
    status: "idle",
    error: null,
    manifest: null,
    runId: generateId(),
    budgets,
  };

  const telemetryLimit = config.telemetryLimit ?? RUNTIME_TELEMETRY_LIMIT;

  const emit = (event: RuntimeEvent) => {
    config.logger?.(event);
  };

  const resolveArtifactId = () => state.manifest?.artifactId ?? config.artifactId ?? null;

  const baseTelemetry = (): RuntimeTelemetryPayload => ({
    surface: config.surface,
    runId: state.runId,
    artifactId: resolveArtifactId(),
    capsuleId: config.capsuleId ?? null,
    bundleUrl: config.bundleUrl ?? null,
    budgets,
  });

  const emitTelemetry = (event: string, payload?: Record<string, unknown>) => {
    if (!config.telemetryEmitter || disposed) return;
    if (telemetryCount >= telemetryLimit) {
      if (!telemetryCapped) {
        telemetryCapped = true;
        config.telemetryEmitter("runtime_events_capped", {
          ...baseTelemetry(),
          cappedAt: telemetryLimit,
        });
      }
      return;
    }
    telemetryCount += 1;
    config.telemetryEmitter(event, {
      ...baseTelemetry(),
      ...(payload ?? {}),
    });
  };

  const publish = () => {
    if (disposed) return;
    subscribers.forEach((cb) => cb({ ...state }));
  };

  const clearBootTimer = () => {
    if (bootTimer) {
      clearTimeout(bootTimer);
      bootTimer = null;
    }
  };

  const clearRunTimer = () => {
    if (runTimer) {
      clearTimeout(runTimer);
      runTimer = null;
    }
  };

  const markError = (message: string) => {
    state.status = "error";
    state.error = message;
    clearBootTimer();
    clearRunTimer();
    emit({ type: "state", status: "error", error: message });
    emitTelemetry("runtime_state", { status: "error", error: message });
    emitTelemetry("runtime_error", { message });
    publish();
  };

  const markReady = () => {
    state.status = "ready";
    state.error = null;
    clearBootTimer();
    emit({ type: "state", status: "ready" });
    const readyDurationMs = bootStartedAt != null ? Date.now() - bootStartedAt : null;
    emitTelemetry("runtime_ready", { durationMs: readyDurationMs });
    emitTelemetry("runtime_state", { status: "ready", durationMs: readyDurationMs });
    publish();
  };

  const startBootTimer = () => {
    clearBootTimer();
    if (budgets.bootMs <= 0) return;
    bootStartedAt = Date.now();
    bootTimer = setTimeout(() => {
      emit({ type: "boot_timeout", durationMs: budgets.bootMs });
      emitTelemetry("runtime_boot_timeout", {
        durationMs: budgets.bootMs,
        budgetMs: budgets.bootMs,
      });
      markError(`Runtime did not start within ${Math.round(budgets.bootMs / 1000)}s.`);
    }, budgets.bootMs);
  };

  const startRunTimer = () => {
    clearRunTimer();
    if (budgets.runMs <= 0) return;
    runTimer = setTimeout(() => {
      emit({ type: "run_timeout", durationMs: budgets.runMs });
      emitTelemetry("runtime_run_timeout", {
        durationMs: budgets.runMs,
        budgetMs: budgets.runMs,
      });
      markError("Runtime session timed out.");
    }, budgets.runMs);
  };

  const loadManifest = async () => {
    state.status = "loading";
    state.error = null;
    publish();
    emitTelemetry("runtime_state", { status: "loading" });
    try {
      const manifest = await loadRuntimeManifest(config.artifactId);
      if (disposed) return;
      state.manifest = manifest;
      emit({
        type: "manifest_loaded",
        artifactId: manifest.artifactId,
        runtimeVersion: manifest.runtimeVersion,
        runtimeType: manifest.type,
      });
      emitTelemetry("runtime_manifest_loaded", {
        artifactId: manifest.artifactId,
        runtimeVersion: manifest.runtimeVersion,
        runtimeType: manifest.type,
      });
      publish();
    } catch (error) {
      if (disposed) return;
      const message =
        error instanceof Error && error.message ? error.message : "Failed to load runtime manifest.";
      markError(message);
    }
  };

  const start = () => {
    if (disposed) return;
    state.runId = generateId();
    telemetryCount = 0;
    telemetryCapped = false;
    state.error = null;
    bootStartedAt = Date.now();
    clearBootTimer();
    clearRunTimer();
    emitTelemetry("runtime_session_started", {
      budgets,
    });
    void loadManifest();
    startBootTimer();
    startRunTimer();
  };

  const stop = () => {
    if (disposed) return;
    state.status = "idle";
    state.error = null;
    clearBootTimer();
    clearRunTimer();
    publish();
  };

  const pause = () => {
    clearRunTimer();
  };

  const resume = () => {
    startRunTimer();
  };

  const dispose = () => {
    disposed = true;
    clearBootTimer();
    clearRunTimer();
    subscribers.clear();
  };

  if (config.autoStart) {
    start();
  }

  return {
    getState: () => ({ ...state }),
    emitTelemetry,
    getBudgets: () => budgets,
    subscribe(listener: Subscriber) {
      subscribers.add(listener);
      listener({ ...state });
      return () => subscribers.delete(listener);
    },
    start,
    stop,
    pause,
    resume,
    dispose,
    setParams(next) {
      paramsRef = next;
    },
    markReady,
    markError,
  };
}
