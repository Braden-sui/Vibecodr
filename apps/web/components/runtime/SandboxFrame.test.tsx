import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SandboxFrame } from "./SandboxFrame";
import type { ClientRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";

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

    expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    expect(iframe).toHaveAttribute("data-runtime-artifact", manifest.artifactId);
    expect(iframe).toHaveAttribute("data-runtime-type", manifest.type);
    expect(iframe).toHaveAttribute("data-runtime-version", manifest.runtimeVersion);
    expect(iframe.getAttribute("srcdoc")).toContain("/runtime-assets/v0.1.0/guard.js");
    expect(iframe.getAttribute("srcdoc")).toContain("/runtime-assets/v0.1.0/bridge.js");
    expect(iframe.getAttribute("srcdoc")).toContain("/runtime-assets/v0.1.0/html-runtime.js");
    expect(iframe.getAttribute("srcdoc")).toContain("https://cdn.example/artifacts/bundle.js");
    expect(iframe.getAttribute("srcdoc")).toContain("window.vibecodrRuntimeOptions");
  });

  it("fires ready and error callbacks", () => {
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

    const iframe = getByTitle("runtime-frame");
    fireEvent.load(iframe);
    expect(onReady).toHaveBeenCalled();

    const errorEvent = new Event("error", { bubbles: true, cancelable: true });
    iframe.dispatchEvent(errorEvent);

    expect(onError).toHaveBeenCalledWith("Failed to load runtime frame");
  });
});
