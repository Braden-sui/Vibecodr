import { describe, it } from "vitest";
import { render } from "@testing-library/react";
import { htmlRuntimeLoader } from "./htmlRuntimeLoader";
import type { ClientRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";

const manifest: ClientRuntimeManifest = {
  artifactId: "html-artifact",
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
    sizeBytes: 2048,
    digest: "c0ffee",
  },
};

describe("htmlRuntimeLoader", () => {
  it("creates a sandboxed HTML runtime iframe", () => {
    const tree = htmlRuntimeLoader({
      manifest,
      bundleUrl: "https://cdn.example/html-bundle.js",
      title: "HTML runtime",
    });

    const { getByTitle } = render(<>{tree}</>);
    const iframe = getByTitle("HTML runtime");

    expect(iframe).toBeInstanceOf(HTMLIFrameElement);
    expect(iframe.getAttribute("srcdoc")).toContain("/runtime-assets/v0.1.0/html-runtime.js");
    expect(iframe.getAttribute("srcdoc")).toContain("https://cdn.example/html-bundle.js");
  });
});
