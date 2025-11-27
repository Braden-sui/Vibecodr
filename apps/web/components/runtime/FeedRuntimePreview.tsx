"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { artifactsApi, capsulesApi } from "@/lib/api";
import { getRuntimeBundleNetworkMode } from "@/lib/runtime/networkMode";
import { RUNTIME_IFRAME_PERMISSIONS, RUNTIME_IFRAME_SANDBOX } from "@/lib/runtime/sandboxPolicies";
import { useRuntimeSession } from "@/lib/runtime/useRuntimeSession";

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
      maxBootMs: 0,
      maxRunMs: 0,
      className,
      title: `Preview for ${capsuleId}`,
      frameRef: iframeRef,
      onReady,
      onError,
    });

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
