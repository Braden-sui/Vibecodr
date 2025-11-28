"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { artifactsApi, capsulesApi } from "@/lib/api";
import { getRuntimeBundleNetworkMode } from "@/lib/runtime/networkMode";
import { RUNTIME_IFRAME_PERMISSIONS, RUNTIME_IFRAME_SANDBOX } from "@/lib/runtime/sandboxPolicies";
import { useRuntimeSession } from "@/lib/runtime/useRuntimeSession";
import type { RuntimeEvent } from "@/lib/runtime/runtimeSession";

export interface FeedRuntimePreviewProps {
  artifactId: string;
  capsuleId: string;
  params?: Record<string, unknown>;
  className?: string;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export const FeedRuntimePreview = forwardRef<HTMLIFrameElement | null, FeedRuntimePreviewProps>(
  function FeedRuntimePreview(
    { artifactId, capsuleId, params, className, onReady, onError },
    forwardedRef
  ) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const runtimeSessionLogger = useCallback(
      (event: RuntimeEvent) => {
        if (event.type === "run_timeout" || event.type === "boot_timeout") {
          console.warn("[feed_preview] runtime session event", {
            artifactId,
            capsuleId,
            event,
          });
        }
      },
      [artifactId, capsuleId]
    );

    useImperativeHandle<HTMLIFrameElement | null, HTMLIFrameElement | null>(
      forwardedRef,
      () => iframeRef.current,
      []
    );

    const bundleUrl = useMemo(() => {
      return artifactsApi.bundleSrc(String(artifactId)) || capsulesApi.bundleSrc(capsuleId);
    }, [artifactId, capsuleId]);

    const { runtimeFrame, state } = useRuntimeSession({
      artifactId,
      capsuleId,
      bundleUrl,
      params,
      surface: "feed",
      autoStart: true,
      className,
      title: `Preview for ${capsuleId}`,
      frameRef: iframeRef,
      onReady,
      onError,
      logger: runtimeSessionLogger,
    });

    useEffect(() => {
      if (state.status === "error" && state.error) {
        onError?.(state.error);
      }
    }, [onError, state.error, state.status]);

    const combinedClassName = ["h-full", "w-full", "border-0", "bg-transparent", className]
      .filter(Boolean)
      .join(" ");
    const runtimeNetworkMode = getRuntimeBundleNetworkMode();

    return (
      runtimeFrame ?? (
        <iframe
          ref={iframeRef}
          title="Vibe runtime preview"
          src={state.status === "error" ? "about:blank" : bundleUrl}
          sandbox={RUNTIME_IFRAME_SANDBOX}
          allow={RUNTIME_IFRAME_PERMISSIONS}
          referrerPolicy="no-referrer"
          className={combinedClassName}
          data-runtime-artifact={artifactId}
          data-runtime-network-mode={runtimeNetworkMode}
          loading="lazy"
        />
      )
    );
  }
);
