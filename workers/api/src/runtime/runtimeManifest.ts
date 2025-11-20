// Runtime manifest builder for iframe runtime loader
// WHY: Runtime asset paths here must stay aligned with apps/web/public/runtime-assets/runtime-index.json.
// This helper currently duplicates the index structure; a later refactor should derive paths directly from that index to avoid drift.

export const RUNTIME_ARTIFACT_TYPES = ["react-jsx", "html"] as const;
export type RuntimeArtifactType = (typeof RUNTIME_ARTIFACT_TYPES)[number];

export interface RuntimeAssetRef {
  path: string;
}

export interface RuntimeManifest {
  artifactId: string;
  type: RuntimeArtifactType;
  runtime: {
    version: string;
    assets: {
      bridge: RuntimeAssetRef;
      guard: RuntimeAssetRef;
      runtimeScript: RuntimeAssetRef;
    };
  };
  bundle: {
    r2Key: string;
    sizeBytes: number;
    digest: string;
  };
}

export interface BuildRuntimeManifestInput {
  artifactId: string;
  type: RuntimeArtifactType;
  bundleKey: string;
  bundleSizeBytes: number;
  bundleDigest: string;
  runtimeVersion?: string;
}

export function buildRuntimeManifest(input: BuildRuntimeManifestInput): RuntimeManifest {
  const runtimeVersion = input.runtimeVersion || "v0.1.0";
  const basePath = `runtime-assets/${runtimeVersion}/`;
  const runtimeScriptFile = input.type === "react-jsx" ? "react-runtime.js" : "html-runtime.js";

  return {
    artifactId: input.artifactId,
    type: input.type,
    runtime: {
      version: runtimeVersion,
      assets: {
        bridge: { path: `${basePath}bridge.js` },
        guard: { path: `${basePath}guard.js` },
        runtimeScript: { path: `${basePath}${runtimeScriptFile}` },
      },
    },
    bundle: {
      r2Key: input.bundleKey,
      sizeBytes: input.bundleSizeBytes,
      digest: input.bundleDigest,
    },
  };
}
