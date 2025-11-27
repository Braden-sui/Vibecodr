"use client";

import { loadRuntimeManifest, type ClientRuntimeManifest } from "./loadRuntimeManifest";

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
}

function defaultBootBudget(surface: RuntimeSurface): number {
  if (surface === "feed") return 6_000;
  if (surface === "embed") return 7_000;
  return 10_000; // player can be slightly more lenient
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

  const state: RuntimeSessionState = {
    status: "idle",
    error: null,
    manifest: null,
    runId: generateId(),
  };

  const maxBootMs = config.maxBootMs ?? defaultBootBudget(config.surface);
  const maxRunMs = config.maxRunMs ?? defaultRunBudget(config.surface);

  const emit = (event: RuntimeEvent) => {
    config.logger?.(event);
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
    publish();
  };

  const markReady = () => {
    state.status = "ready";
    state.error = null;
    clearBootTimer();
    emit({ type: "state", status: "ready" });
    publish();
  };

  const startBootTimer = () => {
    clearBootTimer();
    if (maxBootMs <= 0) return;
    bootTimer = setTimeout(() => {
      emit({ type: "boot_timeout", durationMs: maxBootMs });
      markError(`Runtime did not start within ${Math.round(maxBootMs / 1000)}s.`);
    }, maxBootMs);
  };

  const startRunTimer = () => {
    clearRunTimer();
    if (maxRunMs <= 0) return;
    runTimer = setTimeout(() => {
      emit({ type: "run_timeout", durationMs: maxRunMs });
      markError("Runtime session timed out.");
    }, maxRunMs);
  };

  const loadManifest = async () => {
    state.status = "loading";
    state.error = null;
    publish();
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
    state.error = null;
    clearBootTimer();
    clearRunTimer();
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
