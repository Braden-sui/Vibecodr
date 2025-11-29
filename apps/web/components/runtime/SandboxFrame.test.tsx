import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SandboxFrame } from "./SandboxFrame";
import type { ClientRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";
import { RUNTIME_IFRAME_PERMISSIONS, RUNTIME_IFRAME_SANDBOX } from "@/lib/runtime/sandboxPolicies";

const manifest: ClientRuntimeManifest = {
  artifactId: "artifact-abc",
  type: "html",
  runtimeVersion: "v0.1.0",
  version: 1,
  runtimeAssets: {
    bridgeUrl: "/runtime-assets/v0.1.0/bridge.js",
    guardUrl: "/runtime-assets/v0.1.0/guard.js",
    runtimeScriptUrl: "/runtime-assets/v0.1.0/html-runtime.js",
  },
  bundle: {
    r2Key: "capsules/hash/index.html",
    sizeBytes: 1024,
    digest: "cafebabe",
  },
};

describe("SandboxFrame", () => {
  it("renders an iframe with the manifest metadata", () => {
    const { getByTitle } = render(
      <SandboxFrame
        manifest={manifest}
        bundleUrl="https://cdn.example/artifacts/bundle.js"
        title="runtime-frame"
        params={{ locale: "en-US" }}
      />
    );

    const iframe = getByTitle("runtime-frame");

    expect(iframe).toHaveAttribute("sandbox", RUNTIME_IFRAME_SANDBOX);
    expect(iframe).toHaveAttribute("allow", RUNTIME_IFRAME_PERMISSIONS);
    expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(iframe).toHaveAttribute("data-runtime-artifact", manifest.artifactId);
    expect(iframe).toHaveAttribute("data-runtime-type", manifest.type);
    expect(iframe).toHaveAttribute("data-runtime-version", manifest.runtimeVersion);
    expect(iframe.getAttribute("srcdoc")).toContain("/runtime-assets/v0.1.0/guard.js");
    expect(iframe.getAttribute("srcdoc")).toContain("/runtime-assets/v0.1.0/bridge.js");
    expect(iframe.getAttribute("srcdoc")).toContain("/runtime-assets/v0.1.0/html-runtime.js");
    expect(iframe.getAttribute("srcdoc")).toContain("https://cdn.example/artifacts/bundle.js");
    expect(iframe.getAttribute("srcdoc")).toContain("window.vibecodrRuntimeOptions");
  });

  it("fires ready callback on bridge postMessage", () => {
    const onReady = vi.fn();
    const onError = vi.fn();

    const { getByTitle } = render(
      <SandboxFrame
        manifest={manifest}
        bundleUrl="https://cdn.example/artifacts/bundle.js"
        onReady={onReady}
        onError={onError}
        title="runtime-frame"
      />
    );

    const iframe = getByTitle("runtime-frame") as HTMLIFrameElement;

    // Simulate postMessage from bridge inside iframe
    const messageEvent = new MessageEvent("message", {
      data: { type: "ready", source: "vibecodr-artifact-runtime", payload: {} },
      source: iframe.contentWindow,
    });
    window.dispatchEvent(messageEvent);

    expect(onReady).toHaveBeenCalled();
  });

  it("fires error callback on bridge error postMessage", () => {
    const onReady = vi.fn();
    const onError = vi.fn();

    const { getByTitle } = render(
      <SandboxFrame
        manifest={manifest}
        bundleUrl="https://cdn.example/artifacts/bundle.js"
        onReady={onReady}
        onError={onError}
        title="runtime-frame"
      />
    );

    const iframe = getByTitle("runtime-frame") as HTMLIFrameElement;

    // Simulate error postMessage from bridge
    const messageEvent = new MessageEvent("message", {
      data: {
        type: "error",
        source: "vibecodr-artifact-runtime",
        payload: { message: "Component mount failed" },
      },
      source: iframe.contentWindow,
    });
    window.dispatchEvent(messageEvent);

    expect(onError).toHaveBeenCalledWith("Component mount failed");
  });

  it("fires error callback on iframe error event", () => {
    const onError = vi.fn();

    const { getByTitle } = render(
      <SandboxFrame
        manifest={manifest}
        bundleUrl="https://cdn.example/artifacts/bundle.js"
        onError={onError}
        title="runtime-frame"
      />
    );

    const iframe = getByTitle("runtime-frame");
    const errorEvent = new Event("error", { bubbles: true, cancelable: true });
    iframe.dispatchEvent(errorEvent);

    expect(onError).toHaveBeenCalledWith("Failed to load runtime frame");
  });

  it("includes the provided nonce across CSP and scripts", () => {
    const manifestWithNonce: ClientRuntimeManifest = {
      ...manifest,
      cspNonce: "abc123",
      type: "react-jsx",
    };
    const { getByTitle } = render(
      <SandboxFrame manifest={manifestWithNonce} title="nonce-test" />
    );

    const iframe = getByTitle("nonce-test");
    const srcdoc = iframe.getAttribute("srcdoc") || "";

    expect(srcdoc).toContain("'nonce-abc123'");
    expect(srcdoc).toContain('nonce="abc123"');
    expect(srcdoc).not.toContain("unsafe-inline");
  });

  it("allows HTML runtimes to fetch bundles and inline styles inside the sandbox", () => {
    const { getByTitle } = render(
      <SandboxFrame
        manifest={{ ...manifest, type: "html" }}
        bundleUrl="https://cdn.example/artifacts/html-bundle.html"
        title="html-runtime-frame"
      />
    );

    const srcdoc = getByTitle("html-runtime-frame").getAttribute("srcdoc") || "";

    expect(srcdoc).toMatch(/connect-src\s+https:\/\/cdn\.example/);
    expect(srcdoc).toMatch(/style-src\s+'self'\s+'unsafe-inline'/);
    expect(srcdoc).not.toMatch(/<script[^>]+src="https:\/\/cdn\.example\/artifacts\/html-bundle\.html"/);
  });

  it("includes import map with React and common libraries for react-jsx bundles", () => {
    const reactManifest: ClientRuntimeManifest = {
      ...manifest,
      type: "react-jsx",
      runtimeAssets: {
        ...manifest.runtimeAssets,
        runtimeScriptUrl: "/runtime-assets/v0.1.0/react-runtime.js",
      },
    };

    // Add imports to manifest for dynamic import map
    const manifestWithImports = {
      ...reactManifest,
      imports: ["react", "react-dom", "date-fns", "lodash"],
    };

    const { getByTitle } = render(
      <SandboxFrame
        manifest={manifestWithImports}
        bundleUrl="https://cdn.example/artifacts/bundle.js"
        title="react-runtime-frame"
      />
    );

    const srcdoc = getByTitle("react-runtime-frame").getAttribute("srcdoc") || "";

    // Verify import map is included with discovered packages (dynamic)
    expect(srcdoc).toContain("importmap");
    expect(srcdoc).toContain("https://esm.sh/react");
    expect(srcdoc).toContain("https://esm.sh/react-dom");
    expect(srcdoc).toContain("https://esm.sh/date-fns");
    expect(srcdoc).toContain("https://esm.sh/lodash");

    // Verify bundle is loaded as ES module
    expect(srcdoc).toContain('type="module"');
    expect(srcdoc).toContain("https://cdn.example/artifacts/bundle.js");
  });

  it("does not include import map for HTML runtimes", () => {
    const { getByTitle } = render(
      <SandboxFrame
        manifest={{ ...manifest, type: "html" }}
        bundleUrl="https://cdn.example/artifacts/bundle.html"
        title="html-no-importmap"
      />
    );

    const srcdoc = getByTitle("html-no-importmap").getAttribute("srcdoc") || "";
    expect(srcdoc).not.toContain("importmap");
    expect(srcdoc).not.toContain("esm.sh");
  });
});
