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
import { RUNTIME_IFRAME_PERMISSIONS, RUNTIME_IFRAME_SANDBOX } from "@/lib/runtime/sandboxPolicies";

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

export type BuildSandboxFrameOptions = {
  manifest: ClientRuntimeManifest;
  bundleUrl?: string;
  params?: Record<string, unknown>;
};

function generateNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}`;
}

function getBundleOrigin(bundleUrl: string | undefined): string | null {
  if (!bundleUrl) return null;
  try {
    const url = new URL(bundleUrl, window.location.href);
    return url.origin;
  } catch {
    return null;
  }
}

function buildSandboxCsp(nonce: string, bundleUrl?: string, isHtmlRuntime?: boolean): string {
  const mode = getRuntimeBundleNetworkMode();
  const bundleOrigin = getBundleOrigin(bundleUrl);

  // WHY: HTML bundles need to fetch their content. Always allow the bundle origin
  // in connect-src so the HTML fetch works, even in offline mode.
  let connectSrc: string;
  if (mode === "allow-https") {
    connectSrc = "connect-src 'self' https:";
  } else if (bundleOrigin) {
    // INVARIANT: Allow only the bundle origin for HTML fetches in offline mode
    connectSrc = `connect-src ${bundleOrigin}`;
  } else {
    connectSrc = "connect-src 'none'";
  }

  // WHY: HTML artifacts contain user-uploaded content with arbitrary inline styles.
  // We cannot pre-nonce these, so we allow 'unsafe-inline' for style-src on HTML bundles.
  // SAFETY: The iframe is sandboxed and isolated, limiting the blast radius.
  const styleSrc = isHtmlRuntime
    ? `style-src 'self' 'unsafe-inline'`
    : `style-src 'self' 'nonce-${nonce}'`;

  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' https: blob:`,
    styleSrc,
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
  const nonce = manifest.cspNonce || generateNonce();
  const isHtmlRuntime = manifest.type === "html";

  // WHY: React bundles are JS that registers components and auto-bootstraps.
  // HTML bundles are actual HTML content that must be fetched as text and
  // passed to VibecodrHtmlRuntime.render(). Loading HTML as a <script> fails.
  let bundleLoadScript = "";
  if (hasBundleUrl) {
    if (isHtmlRuntime) {
      // INVARIANT: HTML bundles are fetched as text and rendered via the HTML runtime.
      // The HTML runtime script must load before this executes.
      const escapedBundleUrl = bundleUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      bundleLoadScript = `
    <script nonce="${nonce}">
      (function() {
        var bundleUrl = "${escapedBundleUrl}";
        console.log("[vibecodr] HTML bundle fetch starting", { bundleUrl: bundleUrl });
        fetch(bundleUrl, { mode: "cors", credentials: "omit" })
          .then(function(res) {
            console.log("[vibecodr] HTML bundle fetch response", { status: res.status, ok: res.ok });
            if (!res.ok) {
              throw new Error("E-VIBECODR-2111 HTML bundle fetch failed: " + res.status);
            }
            return res.text();
          })
          .then(function(html) {
            console.log("[vibecodr] HTML bundle loaded", { length: html.length, preview: html.slice(0, 100) });
            if (window.VibecodrHtmlRuntime && typeof window.VibecodrHtmlRuntime.render === "function") {
              window.VibecodrHtmlRuntime.render({ html: html, mountSelector: "#root" });
              console.log("[vibecodr] HTML runtime render called");
            } else {
              console.error("[vibecodr] HTML runtime not available", {
                hasRuntime: !!window.VibecodrHtmlRuntime,
                hasBridge: !!window.vibecodrBridge
              });
              if (window.vibecodrBridge && typeof window.vibecodrBridge.error === "function") {
                window.vibecodrBridge.error("E-VIBECODR-2112 HTML runtime not available", {
                  code: "E-VIBECODR-2112",
                  phase: "bundle-load"
                });
              }
            }
          })
          .catch(function(err) {
            console.error("[vibecodr] HTML bundle fetch error", { error: err.message });
            if (window.vibecodrBridge && typeof window.vibecodrBridge.error === "function") {
              window.vibecodrBridge.error(err.message || "HTML bundle load failed", {
                code: "E-VIBECODR-2111",
                phase: "bundle-fetch"
              });
            }
          });
      })();
    </script>`;
    } else {
      // React/JS bundles load as scripts and self-bootstrap
      bundleLoadScript = `<script nonce="${nonce}" defer src="${bundleUrl}"></script>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <meta
      http-equiv="Content-Security-Policy"
      content="${buildSandboxCsp(nonce, bundleUrl, isHtmlRuntime)}"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style nonce="${nonce}">
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
    <script nonce="${nonce}" src="${manifest.runtimeAssets.guardUrl}"></script>
    <script nonce="${nonce}" src="${manifest.runtimeAssets.bridgeUrl}"></script>
    <script nonce="${nonce}">
      window.vibecodrRuntimeManifest = ${manifestJson};
      window.vibecodrRuntimeOptions = ${optionsJson};
    </script>
    <script nonce="${nonce}" src="${manifest.runtimeAssets.runtimeScriptUrl}"></script>
    ${bundleLoadScript}
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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useImperativeHandle(forwardedRef, () => iframeRef.current as HTMLIFrameElement, []);

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
      sandbox={RUNTIME_IFRAME_SANDBOX}
      allow={RUNTIME_IFRAME_PERMISSIONS}
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
