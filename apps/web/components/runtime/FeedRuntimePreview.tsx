"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { artifactsApi, capsulesApi } from "@/lib/api";
import { loadRuntimeManifest, type ClientRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";
import { loadRuntime } from "@/lib/runtime/registry";
import { getRuntimeBundleNetworkMode } from "@/lib/runtime/networkMode";
import { RUNTIME_IFRAME_PERMISSIONS, RUNTIME_IFRAME_SANDBOX } from "@/lib/runtime/sandboxPolicies";

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
    const [runtimeManifest, setRuntimeManifest] = useState<ClientRuntimeManifest | null>(null);
    const [runtimeFrame, setRuntimeFrame] = useState<ReactElement | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    useImperativeHandle<HTMLIFrameElement | null, HTMLIFrameElement | null>(
      forwardedRef,
      () => iframeRef.current,
      []
    );

    const bundleUrl = useMemo(
      () => artifactsApi.bundleSrc(String(artifactId)) || capsulesApi.bundleSrc(capsuleId),
      [artifactId, capsuleId]
    );

    useEffect(() => {
      let cancelled = false;
      setRuntimeManifest(null);
      setRuntimeFrame(null);
      setLoadError(null);

      (async () => {
        try {
          const manifest = await loadRuntimeManifest(String(artifactId));
          if (cancelled) return;
          setRuntimeManifest(manifest);
        } catch (error) {
          if (cancelled) return;
          const message = "Preview failed to load.";
          setLoadError(message);
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("E-VIBECODR-2113 feed runtime manifest load failed", {
              artifactId,
              capsuleId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          onError?.(message);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [artifactId, capsuleId, onError]);

    useEffect(() => {
      if (!runtimeManifest) {
        return;
      }

      try {
        const frame = loadRuntime(runtimeManifest.type, {
          manifest: runtimeManifest,
          bundleUrl,
          params,
          className,
          title: `Preview for ${capsuleId}`,
          frameRef: iframeRef,
          onReady: () => {
            setLoadError(null);
            onReady?.();
          },
          onError: (message) => {
            const normalized = message || "Preview failed to load.";
            setLoadError(normalized);
            onError?.(normalized);
          },
        });
        setRuntimeFrame(frame);
      } catch (error) {
        const message = "Preview failed to start.";
        setLoadError(message);
        setRuntimeFrame(null);
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("E-VIBECODR-2114 feed runtime loader failed", {
            artifactId,
            capsuleId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        onError?.(message);
      }
    }, [artifactId, bundleUrl, capsuleId, className, onError, onReady, params, runtimeManifest]);

    const combinedClassName = ["h-full", "w-full", "border-0", "bg-transparent", className]
      .filter(Boolean)
      .join(" ");
    const runtimeNetworkMode = getRuntimeBundleNetworkMode();

    return (
      runtimeFrame ?? (
        <iframe
          ref={iframeRef}
          title="Vibe runtime preview"
          src={loadError ? "about:blank" : bundleUrl}
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
