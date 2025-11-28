"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadRuntime } from "./registry";
import type { RuntimeLoaderArgs } from "./types";
import { createRuntimeSession, type RuntimeSessionConfig, type RuntimeSessionState } from "./runtimeSession";
import { trackRuntimeEvent } from "@/lib/analytics";
import { getRuntimeBudgets } from "@/components/Player/runtimeBudgets";

type UseRuntimeSessionConfig = RuntimeSessionConfig & {
  frameRef?: React.RefObject<HTMLIFrameElement>;
  className?: string;
  title?: string;
  onReady?: () => void;
  onError?: (message: string) => void;
  onPolicyViolation?: RuntimeLoaderArgs["onPolicyViolation"];
  telemetryEmitter?: RuntimeSessionConfig["telemetryEmitter"];
  telemetryLimit?: number;
  logger?: RuntimeSessionConfig["logger"];
};

export function useRuntimeSession(config: UseRuntimeSessionConfig) {
  const { frameRef: externalFrameRef, onReady, onError, onPolicyViolation } = config;
  const iframeRef = externalFrameRef ?? useRef<HTMLIFrameElement>(null);
  const surfaceBudgets = useMemo(() => getRuntimeBudgets(config.surface), [config.surface]);
  const maxBootMs = config.maxBootMs ?? surfaceBudgets.clientStaticBootMs;
  const maxRunMs = config.maxRunMs ?? surfaceBudgets.runSessionMs;
  const sessionRef = useRef(
    createRuntimeSession({
      ...config,
      maxBootMs,
      maxRunMs,
      autoStart: false,
      telemetryEmitter: config.telemetryEmitter ?? trackRuntimeEvent,
      telemetryLimit: config.telemetryLimit,
      logger: config.logger,
    })
  );
  const [sessionState, setSessionState] = useState<RuntimeSessionState>(sessionRef.current.getState());
  const paramsRef = useRef(config.params);

  paramsRef.current = config.params;

  // Recreate session when artifactId or surface changes meaningfully
  useEffect(() => {
    const next = createRuntimeSession({
      ...config,
      maxBootMs,
      maxRunMs,
      telemetryEmitter: config.telemetryEmitter ?? trackRuntimeEvent,
      telemetryLimit: config.telemetryLimit,
      logger: config.logger,
    });
    const prev = sessionRef.current;
    sessionRef.current = next;
    setSessionState(next.getState());
    const unsubscribe = next.subscribe(setSessionState);
    prev.dispose();
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.artifactId, config.surface, config.logger, maxBootMs, maxRunMs]);

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
  }, [config.bundleUrl, config.className, config.title, onError, onPolicyViolation, onReady, sessionState.manifest]);

  return {
    session: sessionRef.current,
    state: sessionState,
    iframeRef,
    runtimeFrame,
  };
}
