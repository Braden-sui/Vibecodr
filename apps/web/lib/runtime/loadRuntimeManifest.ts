import { artifactsApi } from "@/lib/api";

export type ClientRuntimeType = "react-jsx" | "html";

export interface ClientRuntimeBundle {
  r2Key: string;
  sizeBytes: number;
  digest: string;
}

export interface ClientRuntimeAssets {
  bridgeUrl: string;
  guardUrl: string;
  runtimeScriptUrl: string;
}

export interface ClientRuntimeManifest {
  artifactId: string;
  type: ClientRuntimeType;
  runtimeVersion: string;
  version: number;
  runtimeAssets: ClientRuntimeAssets;
  bundle: ClientRuntimeBundle;
}

interface WorkerRuntimeManifestResponse {
  artifactId: string | number;
  type: string;
  runtimeVersion?: string | null;
  version?: number;
  manifest?: {
    artifactId?: string | number;
    type?: string;
    runtime?: {
      version?: string;
      assets?: {
        bridge?: { path?: string };
        guard?: { path?: string };
        runtimeScript?: { path?: string };
      };
    };
    bundle?: {
      r2Key?: string;
      sizeBytes?: number;
      digest?: string;
    };
  };
}

function toAbsoluteAssetPath(path: string): string {
  if (!path) return "";
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeRuntimeType(value: unknown): ClientRuntimeType {
  if (typeof value !== "string") {
    return "react-jsx";
  }
  return value === "html" ? "html" : "react-jsx";
}

function requireAssetPath(path: string, label: string, artifactId: string): string {
  if (!path.trim()) {
    throw new Error(`E-VIBECODR-2110 runtime manifest missing ${label} asset for ${artifactId}`);
  }
  return path;
}

export async function loadRuntimeManifest(artifactId: string): Promise<ClientRuntimeManifest> {
  const res = await artifactsApi.manifest(artifactId);

  if (!res.ok) {
    throw new Error(`E-VIBECODR-2109 failed to load runtime manifest for ${artifactId}: ${res.status}`);
  }

  const data = (await res.json()) as WorkerRuntimeManifestResponse;

  const serverManifest = data.manifest ?? {};
  const type: ClientRuntimeType = normalizeRuntimeType(data.type ?? serverManifest.type);

  const runtimeVersion =
    data.runtimeVersion || serverManifest.runtime?.version || "v0.1.0";

  const assets = serverManifest.runtime?.assets ?? {};
  const bridgePath = requireAssetPath(String(assets.bridge?.path ?? ""), "bridge", artifactId);
  const guardPath = requireAssetPath(String(assets.guard?.path ?? ""), "guard", artifactId);
  const runtimeScriptPath = requireAssetPath(
    String(assets.runtimeScript?.path ?? ""),
    "runtime script",
    artifactId
  );

  const bundle = serverManifest.bundle ?? {};

  return {
    artifactId: String(data.artifactId ?? serverManifest.artifactId ?? artifactId),
    type,
    runtimeVersion,
    version: Number(data.version ?? 1),
    runtimeAssets: {
      bridgeUrl: toAbsoluteAssetPath(bridgePath),
      guardUrl: toAbsoluteAssetPath(guardPath),
      runtimeScriptUrl: toAbsoluteAssetPath(runtimeScriptPath),
    },
    bundle: {
      r2Key: String(bundle.r2Key ?? ""),
      sizeBytes: Number(bundle.sizeBytes ?? 0),
      digest: String(bundle.digest ?? ""),
    },
  };
}
