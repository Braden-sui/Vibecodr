"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type { ClientRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";
import type { PolicyViolationEvent } from "@/lib/runtime/types";
import { getRuntimeBundleNetworkMode } from "@/lib/runtime/networkMode";

export interface SandboxFrameProps {
  manifest: ClientRuntimeManifest;
  bundleUrl?: string;
  params?: Record<string, unknown>;
  title?: string;
  className?: string;
  onReady?: () => void;
  onError?: (message: string) => void;
  onPolicyViolation?: (event: PolicyViolationEvent) => void;
}

function buildSandboxCsp(): string {
  const mode = getRuntimeBundleNetworkMode();
  const connectSrc = mode === "allow-https" ? "connect-src 'self' https:" : "connect-src 'none'";

  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' https: blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    connectSrc,
  ].join("; ");
}

export function buildSandboxFrameSrcDoc({
  manifest,
  bundleUrl,
  params,
}: BuildSandboxFrameOptions): string {
  const manifestJson = JSON.stringify(manifest);
  const optionsJson = JSON.stringify({
    bundleUrl: bundleUrl || null,
    params: params || null,
  });
  const hasBundleUrl = typeof bundleUrl === "string" && bundleUrl.length > 0;

  const bundleScript = hasBundleUrl
    ? `<script defer src="${bundleUrl}"></script>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <meta
      http-equiv="Content-Security-Policy"
      content="${buildSandboxCsp()}"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html,
      body,
      #root {
        margin: 0;
        min-height: 100%;
        min-width: 100%;
        height: 100%;
        width: 100%;
        background: transparent;
      }
    </style>
    <script src="${manifest.runtimeAssets.guardUrl}"></script>
    <script src="${manifest.runtimeAssets.bridgeUrl}"></script>
    <script>
      window.vibecodrRuntimeManifest = ${manifestJson};
      window.vibecodrRuntimeOptions = ${optionsJson};
    </script>
    ${bundleScript}
    <script src="${manifest.runtimeAssets.runtimeScriptUrl}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
}

export const SandboxFrame = forwardRef<HTMLIFrameElement, SandboxFrameProps>(function SandboxFrame(
  {
    manifest,
    bundleUrl,
    params,
    title = "Vibecodr runtime",
    className,
    onReady,
    onError,
    onPolicyViolation,
  },
  forwardedRef
) {
  const srcDoc = useMemo(
    () => buildSandboxFrameSrcDoc({ manifest, bundleUrl, params }),
    [manifest, bundleUrl, params]
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useImperativeHandle(forwardedRef, () => iframeRef.current, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const loadHandler = () => {
      if (typeof onReady === "function") {
        onReady();
      }
    };

    const errorHandler = () => {
      if (typeof onError === "function") {
        onError("Failed to load runtime frame");
      }
    };

    iframe.addEventListener("load", loadHandler);
    iframe.addEventListener("error", errorHandler);

    return () => {
      iframe.removeEventListener("load", loadHandler);
      iframe.removeEventListener("error", errorHandler);
    };
  }, [onReady, onError]);

  const combinedClassName = ["block", "w-full", "h-full", "border-0", "bg-transparent", className]
    .filter(Boolean)
    .join(" ");
  const networkMode = getRuntimeBundleNetworkMode();

  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={combinedClassName}
      data-runtime-artifact={manifest.artifactId}
      data-runtime-type={manifest.type}
      data-runtime-version={manifest.runtimeVersion}
      data-runtime-network-mode={networkMode}
      loading="lazy"
      ref={iframeRef}
    />
  );
});
