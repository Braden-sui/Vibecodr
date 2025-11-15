/// <reference types="vitest" />
import { describe, it, expect } from "vitest";
import { buildRuntimeManifest } from "./runtimeManifest";

describe("buildRuntimeManifest", () => {
  it("builds manifest for react-jsx runtime", () => {
    const manifest = buildRuntimeManifest({
      artifactId: "a-react",
      type: "react-jsx",
      bundleKey: "capsules/hash/index.html",
      bundleSizeBytes: 1234,
      bundleDigest: "deadbeef",
    });

    expect(manifest.artifactId).toBe("a-react");
    expect(manifest.type).toBe("react-jsx");
    expect(manifest.runtime.version).toBe("v0.1.0");
    expect(manifest.runtime.assets.bridge.path).toBe("runtime-assets/v0.1.0/bridge.js");
    expect(manifest.runtime.assets.guard.path).toBe("runtime-assets/v0.1.0/guard.js");
    expect(manifest.runtime.assets.runtimeScript.path).toBe(
      "runtime-assets/v0.1.0/react-runtime.js",
    );
    expect(manifest.bundle.r2Key).toBe("capsules/hash/index.html");
    expect(manifest.bundle.sizeBytes).toBe(1234);
    expect(manifest.bundle.digest).toBe("deadbeef");
  });

  it("builds manifest for html runtime", () => {
    const manifest = buildRuntimeManifest({
      artifactId: "a-html",
      type: "html",
      bundleKey: "capsules/hash/index.html",
      bundleSizeBytes: 2048,
      bundleDigest: "cafebabe",
    });

    expect(manifest.artifactId).toBe("a-html");
    expect(manifest.type).toBe("html");
    expect(manifest.runtime.version).toBe("v0.1.0");
    expect(manifest.runtime.assets.runtimeScript.path).toBe(
      "runtime-assets/v0.1.0/html-runtime.js",
    );
    expect(manifest.bundle.sizeBytes).toBe(2048);
    expect(manifest.bundle.digest).toBe("cafebabe");
  });
});
