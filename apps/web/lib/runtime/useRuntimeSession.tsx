"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadRuntime } from "./registry";
import type { RuntimeLoaderArgs } from "./types";
import { createRuntimeSession, type RuntimeSessionConfig, type RuntimeSessionState } from "./runtimeSession";
import type { ClientRuntimeManifest } from "./loadRuntimeManifest";

type UseRuntimeSessionConfig = RuntimeSessionConfig & {
  frameRef?: React.RefObject<HTMLIFrameElement>;
  className?: string;
  title?: string;
  onReady?: () => void;
  onError?: (message: string) => void;
  onPolicyViolation?: RuntimeLoaderArgs["onPolicyViolation"];
};

export function useRuntimeSession(config: UseRuntimeSessionConfig) {
  const { frameRef: externalFrameRef, onReady, onError, onPolicyViolation } = config;
  const iframeRef = externalFrameRef ?? useRef<HTMLIFrameElement>(null);
  const sessionRef = useRef(createRuntimeSession({ ...config, autoStart: false }));
  const [sessionState, setSessionState] = useState<RuntimeSessionState>(sessionRef.current.getState());
  const paramsRef = useRef(config.params);
  const manifestRef = useRef<ClientRuntimeManifest | null>(null);

  paramsRef.current = config.params;

  // Recreate session when artifactId or surface changes meaningfully
  useEffect(() => {
    const next = createRuntimeSession(config);
    const prev = sessionRef.current;
    sessionRef.current = next;
    setSessionState(next.getState());
    const unsubscribe = next.subscribe(setSessionState);
    prev.dispose();
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.artifactId, config.surface]);

  // Build runtime frame when manifest is ready
  const runtimeFrame = useMemo(() => {
    const manifest = sessionState.manifest;
    if (!manifest) return null;
    manifestRef.current = manifest;
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
