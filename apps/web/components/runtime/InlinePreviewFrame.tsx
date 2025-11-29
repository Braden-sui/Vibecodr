"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { RUNTIME_IFRAME_PERMISSIONS, RUNTIME_IFRAME_SANDBOX } from "@/lib/runtime/sandboxPolicies";

export interface InlinePreviewFrameProps {
  /** Raw JSX/TSX code to preview */
  code: string;
  /** Optional additional npm packages to load (beyond react/react-dom) */
  extraPackages?: string[];
  /** Title for the iframe */
  title?: string;
  /** CSS class name */
  className?: string;
  /** Called when the preview successfully renders */
  onReady?: () => void;
  /** Called when an error occurs (transpilation or runtime) */
  onError?: (message: string) => void;
}

/**
 * Generate a nonce for CSP
 */
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

/**
 * Extract npm package names from import statements.
 * Handles scoped packages (@scope/pkg) and subpaths (pkg/subpath).
 */
function extractPackages(code: string): string[] {
  const packages = new Set<string>();
  
  // Match: import X from 'pkg' or import { X } from 'pkg' or import 'pkg'
  const importRegex = /import\s+(?:[^"']+\s+from\s+)?['"]([^"']+)['"];?/g;
  let match: RegExpExecArray | null;
  
  while ((match = importRegex.exec(code)) !== null) {
    const specifier = match[1];
    // Skip relative imports
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
      continue;
    }
    
    // Extract package name (handle scoped packages)
    let pkgName: string;
    if (specifier.startsWith("@")) {
      const parts = specifier.split("/");
      pkgName = parts.slice(0, 2).join("/");
    } else {
      pkgName = specifier.split("/")[0];
    }
    packages.add(pkgName);
  }
  
  return Array.from(packages);
}

/**
 * Build CSP for the inline preview.
 * More permissive than published artifacts since this is preview-only.
 */
function buildPreviewCsp(nonce: string): string {
  return [
    "default-src 'none'",
    // Allow Babel, esm.sh scripts
    `script-src 'nonce-${nonce}' https://esm.sh https://unpkg.com 'unsafe-eval'`,
    // Allow inline styles from user code
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data: blob: https:",
    // Allow fetching from esm.sh for module resolution
    "connect-src 'self' https://esm.sh https://unpkg.com",
  ].join("; ");
}

/**
 * Build the srcdoc for in-browser preview with Babel transpilation.
 * This is a CodePen-style approach: no server round-trip, instant feedback.
 */
function buildPreviewSrcDoc(code: string, extraPackages: string[], nonce: string): string {
  // Always include react and react-dom
  const allPackages = new Set(["react", "react-dom", ...extractPackages(code), ...extraPackages]);
  
  // Build import map for esm.sh resolution
  const importMapEntries = Array.from(allPackages).flatMap((pkg) => [
    `"${pkg}": "https://esm.sh/${pkg}"`,
    `"${pkg}/": "https://esm.sh/${pkg}/"`,
  ]);

  // Escape user code for embedding in script
  const escapedCode = code
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex" />
  <meta
    http-equiv="Content-Security-Policy"
    content="${buildPreviewCsp(nonce)}"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style nonce="${nonce}">
    html, body, #root {
      margin: 0;
      min-height: 100%;
      min-width: 100%;
      height: 100%;
      width: 100%;
      background: transparent;
    }
    .preview-error {
      color: #ef4444;
      font-family: ui-monospace, monospace;
      font-size: 14px;
      padding: 16px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
  <script type="importmap" nonce="${nonce}">
  {
    "imports": {
      ${importMapEntries.join(",\n      ")}
    }
  }
  </script>
</head>
<body>
  <div id="root"></div>
  
  <script nonce="${nonce}" src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
  <script nonce="${nonce}" type="module">
    // WHY: In-browser Babel transpilation for instant preview.
    // This eliminates server round-trips for the composer preview.
    
    const userCode = \`${escapedCode}\`;
    const root = document.getElementById("root");
    
    function showError(message) {
      root.innerHTML = '<div class="preview-error">' + escapeHtml(message) + '</div>';
      window.parent.postMessage({
        source: "vibecodr-inline-preview",
        type: "error",
        payload: { message }
      }, "*");
    }
    
    function escapeHtml(str) {
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    
    try {
      // Transpile JSX with Babel
      const result = Babel.transform(userCode, {
        presets: [
          ["react", { runtime: "automatic" }],
          ["typescript", { isTSX: true, allExtensions: true }]
        ],
        filename: "preview.tsx"
      });
      
      const transpiledCode = result.code;
      
      // Create a blob URL for the transpiled module
      const moduleBlob = new Blob([transpiledCode], { type: "application/javascript" });
      const moduleUrl = URL.createObjectURL(moduleBlob);
      
      // Import React and ReactDOM
      const React = await import("react");
      const ReactDOM = await import("react-dom/client");
      
      // Import the user's module
      const userModule = await import(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      
      // Find the component to render (default export or first function export)
      let Component = userModule.default;
      if (!Component) {
        for (const [key, value] of Object.entries(userModule)) {
          if (typeof value === "function") {
            Component = value;
            break;
          }
        }
      }
      
      if (!Component) {
        // No component found, but code executed successfully
        window.parent.postMessage({
          source: "vibecodr-inline-preview",
          type: "ready",
          payload: { hasComponent: false }
        }, "*");
        return;
      }
      
      // Mount the component
      const reactRoot = ReactDOM.createRoot(root);
      reactRoot.render(React.createElement(Component));
      
      window.parent.postMessage({
        source: "vibecodr-inline-preview",
        type: "ready",
        payload: { hasComponent: true }
      }, "*");
      
    } catch (err) {
      const message = err.message || String(err);
      showError(message);
    }
  </script>
</body>
</html>`;
}

/**
 * InlinePreviewFrame - Client-side JSX preview using in-browser Babel.
 * 
 * WHY: This provides instant feedback while typing, similar to CodePen.
 * No server compilation needed for previews - the sandbox is the security boundary.
 * 
 * For published artifacts, we still use server-side compilation for:
 * - CDN caching (faster loads for viewers)
 * - Consistent bundle output
 * - Size quota enforcement
 */
export const InlinePreviewFrame = forwardRef<HTMLIFrameElement, InlinePreviewFrameProps>(
  function InlinePreviewFrame(
    { code, extraPackages = [], title = "Code preview", className, onReady, onError },
    forwardedRef
  ) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const [nonce] = useState(() => generateNonce());

    useImperativeHandle(forwardedRef, () => iframeRef.current as HTMLIFrameElement, []);

    // Build srcdoc when code or packages change
    const srcDoc = useMemo(() => {
      if (!code.trim()) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      font-family: system-ui, sans-serif;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <p>Start typing to see a preview...</p>
</body>
</html>`;
      }
      return buildPreviewSrcDoc(code, extraPackages, nonce);
    }, [code, extraPackages, nonce]);

    // Listen for messages from the preview iframe
    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        // Only accept messages from our iframe
        if (event.source !== iframe.contentWindow) return;

        const data = event.data;
        if (!data || typeof data !== "object" || data.source !== "vibecodr-inline-preview") return;

        switch (data.type) {
          case "ready":
            onReady?.();
            break;
          case "error":
            onError?.(data.payload?.message || "Preview error");
            break;
        }
      };

      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [onReady, onError]);

    const combinedClassName = ["block", "w-full", "h-full", "border-0", "bg-white", className]
      .filter(Boolean)
      .join(" ");

    return (
      <iframe
        ref={iframeRef}
        title={title}
        srcDoc={srcDoc}
        sandbox={RUNTIME_IFRAME_SANDBOX}
        allow={RUNTIME_IFRAME_PERMISSIONS}
        referrerPolicy="no-referrer"
        className={combinedClassName}
        data-preview-nonce={nonce}
      />
    );
  }
);

export default InlinePreviewFrame;
