"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadRuntime } from "./registry";
import type { RuntimeLoaderArgs } from "./types";
import { createRuntimeSession, type RuntimeEvent, type RuntimeSessionConfig, type RuntimeSessionState } from "./runtimeSession";
import { trackRuntimeEvent } from "@/lib/analytics";
import { getRuntimeBudgets } from "@/components/Player/runtimeBudgets";

type UseRuntimeSessionConfig = RuntimeSessionConfig & {
  frameRef?: React.RefObject<HTMLIFrameElement>;
  className?: string;
  title?: string;
  onReady?: () => void;
  onError?: (message: string) => void;
  onPolicyViolation?: RuntimeLoaderArgs["onPolicyViolation"];
  /** Called when boot timeout is triggered by the session timer. */
  onBootTimeout?: (durationMs: number) => void;
  /** Called when run timeout is triggered by the session timer. */
  onRunTimeout?: (durationMs: number) => void;
  telemetryEmitter?: RuntimeSessionConfig["telemetryEmitter"];
  telemetryLimit?: number;
  logger?: RuntimeSessionConfig["logger"];
};

export function useRuntimeSession(config: UseRuntimeSessionConfig) {
  const { frameRef: externalFrameRef, onReady, onError, onPolicyViolation, onBootTimeout, onRunTimeout } = config;
  const iframeRef = externalFrameRef ?? useRef<HTMLIFrameElement>(null);
  const surfaceBudgets = useMemo(() => getRuntimeBudgets(config.surface), [config.surface]);
  const resolvedRunner = config.runnerType ?? "client-static";
  const maxBootMs =
    config.maxBootMs ??
    (resolvedRunner === "webcontainer"
      ? surfaceBudgets.webContainerBootHardKillMs
      : surfaceBudgets.clientStaticBootMs);
  const maxRunMs = config.maxRunMs ?? surfaceBudgets.runSessionMs;

  // Store timeout callbacks in refs to avoid effect re-runs
  const onBootTimeoutRef = useRef(onBootTimeout);
  const onRunTimeoutRef = useRef(onRunTimeout);
  useEffect(() => {
    onBootTimeoutRef.current = onBootTimeout;
    onRunTimeoutRef.current = onRunTimeout;
  }, [onBootTimeout, onRunTimeout]);

  // Wrap the user's logger to intercept timeout events and call callbacks
  const wrappedLogger = useCallback(
    (event: RuntimeEvent) => {
      config.logger?.(event);
      if (event.type === "boot_timeout") {
        onBootTimeoutRef.current?.(event.durationMs);
      } else if (event.type === "run_timeout") {
        onRunTimeoutRef.current?.(event.durationMs);
      }
    },
    [config.logger]
  );

  const sessionRef = useRef(
    createRuntimeSession({
      ...config,
      runnerType: config.runnerType,
      maxBootMs,
      maxRunMs,
      autoStart: false,
      telemetryEmitter: config.telemetryEmitter ?? trackRuntimeEvent,
      telemetryLimit: config.telemetryLimit,
      logger: wrappedLogger,
    })
  );
  const [sessionState, setSessionState] = useState<RuntimeSessionState>(sessionRef.current.getState());
  const paramsRef = useRef(config.params);

  paramsRef.current = config.params;

  // Recreate session when artifactId or surface changes meaningfully
  useEffect(() => {
    const next = createRuntimeSession({
      ...config,
      runnerType: config.runnerType,
      maxBootMs,
      maxRunMs,
      telemetryEmitter: config.telemetryEmitter ?? trackRuntimeEvent,
      telemetryLimit: config.telemetryLimit,
      logger: wrappedLogger,
    });
    const prev = sessionRef.current;
    sessionRef.current = next;
    setSessionState(next.getState());
    const unsubscribe = next.subscribe(setSessionState);
    prev.dispose();
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.artifactId, config.surface, config.runnerType, wrappedLogger, maxBootMs, maxRunMs]);

  // Build runtime frame when manifest is ready
  const runtimeFrame = useMemo(() => {
    const manifest = sessionState.manifest;
    if (!manifest) return null;
    const args: RuntimeLoaderArgs = {
      manifest,
      bundleUrl: config.bundleUrl,
      params: paramsRef.current ?? undefined,
      className: config.className,
      title: config.title ?? "Vibecodr runtime",
      frameRef: iframeRef,
      onReady: () => {
        sessionRef.current.markReady();
        onReady?.();
      },
      onError: (message) => {
        sessionRef.current.markError(message);
        onError?.(message);
      },
      onPolicyViolation,
    };
    return loadRuntime(manifest.type, args);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config.bundleUrl,
    config.className,
    config.title,
    config.runnerType,
    onError,
    onPolicyViolation,
    onReady,
    sessionState.manifest,
  ]);

  return {
    session: sessionRef.current,
    state: sessionState,
    iframeRef,
    runtimeFrame,
    /** Boot and run budgets resolved for this surface/runner combination */
    budgets: { bootMs: maxBootMs, runMs: maxRunMs },
  };
}
