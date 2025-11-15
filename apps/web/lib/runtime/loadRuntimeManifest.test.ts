import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadRuntimeManifest } from "./loadRuntimeManifest";

describe("loadRuntimeManifest", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch as any;
  });

  it("normalizes worker manifest response into client runtime manifest", async () => {
    const mockResponse = {
      artifactId: "a1",
      type: "react-jsx",
      runtimeVersion: "v0.1.0",
      version: 1,
      manifest: {
        artifactId: "a1",
        type: "react-jsx",
        runtime: {
          version: "v0.1.0",
          assets: {
            bridge: { path: "runtime-assets/v0.1.0/bridge.js" },
            guard: { path: "runtime-assets/v0.1.0/guard.js" },
            runtimeScript: { path: "runtime-assets/v0.1.0/react-runtime.js" },
          },
        },
        bundle: {
          r2Key: "capsules/hash/index.html",
          sizeBytes: 1234,
          digest: "deadbeef",
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as any);

    const result = await loadRuntimeManifest("a1");

    expect(global.fetch).toHaveBeenCalledWith("/api/artifacts/a1/manifest");
    expect(result.artifactId).toBe("a1");
    expect(result.type).toBe("react-jsx");
    expect(result.runtimeVersion).toBe("v0.1.0");
    expect(result.version).toBe(1);
    expect(result.runtimeAssets.bridgeUrl).toBe("/runtime-assets/v0.1.0/bridge.js");
    expect(result.runtimeAssets.guardUrl).toBe("/runtime-assets/v0.1.0/guard.js");
    expect(result.runtimeAssets.runtimeScriptUrl).toBe("/runtime-assets/v0.1.0/react-runtime.js");
    expect(result.bundle.r2Key).toBe("capsules/hash/index.html");
    expect(result.bundle.sizeBytes).toBe(1234);
    expect(result.bundle.digest).toBe("deadbeef");
  });

  it("throws when worker returns non-OK status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    } as any);

    await expect(loadRuntimeManifest("missing"))
      .rejects.toThrowError(/Failed to load runtime manifest/);
  });
});
