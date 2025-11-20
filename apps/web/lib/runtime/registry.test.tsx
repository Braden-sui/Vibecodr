import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadRuntime, registerRuntime, getRuntimeLoader } from "./registry";
import type { RuntimeLoaderArgs, RuntimeLoader } from "./types";
import type { ClientRuntimeManifest } from "./loadRuntimeManifest";

const manifest: ClientRuntimeManifest = {
  artifactId: "artifact-123",
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
    sizeBytes: 4567,
    digest: "deadbeef",
  },
};

describe("runtime registry", () => {
  let originalLoader: RuntimeLoader | undefined;

  beforeEach(() => {
    originalLoader = getRuntimeLoader("react-jsx");
  });

  afterEach(() => {
    if (originalLoader) {
      registerRuntime("react-jsx", originalLoader);
    }
  });

  it("uses the registered loader for rendering", () => {
    const stubLoader = vi.fn().mockReturnValue(<div data-testid="stub-runtime" />);
    registerRuntime("react-jsx", stubLoader);

    const args: RuntimeLoaderArgs = {
      manifest,
      bundleUrl: "https://cdn.example/capsule/bundle.js",
    };

    const result = loadRuntime("react-jsx", args);

    expect(stubLoader).toHaveBeenCalledWith(args);
    expect(result).not.toBeNull();
  });
});
