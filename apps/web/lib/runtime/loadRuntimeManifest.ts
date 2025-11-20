import { getWorkerApiBase } from "@/lib/worker-api";

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

function getRuntimeManifestUrl(artifactId: string): string {
  const base = getWorkerApiBase();
  const encodedId = encodeURIComponent(artifactId);
  return `${base}/artifacts/${encodedId}/manifest`;
}

export async function loadRuntimeManifest(artifactId: string): Promise<ClientRuntimeManifest> {
  const res = await fetch(getRuntimeManifestUrl(artifactId));

  if (!res.ok) {
    throw new Error(`Failed to load runtime manifest for ${artifactId}: ${res.status}`);
  }

  const data = (await res.json()) as WorkerRuntimeManifestResponse;

  const type: ClientRuntimeType = data.type === "html" ? "html" : "react-jsx";
  const serverManifest = data.manifest ?? {};

  const runtimeVersion =
    data.runtimeVersion || serverManifest.runtime?.version || "v0.1.0";

  const assets = serverManifest.runtime?.assets ?? {};
  const bridgePath = String(assets.bridge?.path ?? "");
  const guardPath = String(assets.guard?.path ?? "");
  const runtimeScriptPath = String(assets.runtimeScript?.path ?? "");

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
