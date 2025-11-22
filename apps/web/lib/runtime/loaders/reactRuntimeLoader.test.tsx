import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { reactRuntimeLoader } from "./reactRuntimeLoader";
import type { ClientRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";

const manifest: ClientRuntimeManifest = {
  artifactId: "react-artifact",
  type: "react-jsx",
  runtimeVersion: "v0.1.0",
  version: 1,
  runtimeAssets: {
    bridgeUrl: "/runtime-assets/v0.1.0/bridge.js",
    guardUrl: "/runtime-assets/v0.1.0/guard.js",
    runtimeScriptUrl: "/runtime-assets/v0.1.0/react-runtime.js",
  },
  bundle: {
    r2Key: "capsules/hash/index.html",
    sizeBytes: 1024,
    digest: "feedface",
  },
};

describe("reactRuntimeLoader", () => {
  it("renders the sandbox frame for the React runtime", () => {
    const tree = reactRuntimeLoader({
      manifest,
      bundleUrl: "https://cdn.example/react-bundle.js",
      title: "React runtime",
    });

    const { getByTitle } = render(<>{tree}</>);
    const iframe = getByTitle("React runtime");

    expect(iframe).toBeInstanceOf(HTMLIFrameElement);
    expect(iframe.getAttribute("srcdoc")).toContain("/runtime-assets/v0.1.0/react-runtime.js");
    expect(iframe.getAttribute("srcdoc")).toContain("https://cdn.example/react-bundle.js");
  });
});
