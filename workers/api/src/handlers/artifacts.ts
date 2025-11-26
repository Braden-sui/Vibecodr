import type { Env, Handler } from "../types";
import { requireAuth, type AuthenticatedUser } from "../auth";
import {
  getUserPlan,
  getUserStorageUsage,
  checkBundleSize,
  checkStorageQuota,
  getUserRunQuotaState,
} from "../storage/quotas";
import { RUNTIME_ARTIFACT_TYPES, type RuntimeManifest, type RuntimeArtifactType } from "../runtime/runtimeManifest";
import {
  ERROR_RUNTIME_MANIFEST_KV_UNAVAILABLE,
  ERROR_RUNTIME_MANIFEST_LOAD_FAILED,
  ERROR_RUNTIME_MANIFEST_PARSE_FAILED,
} from "@vibecodr/shared";
import { invalidateLatestArtifactCache } from "../feed-artifacts";
import { buildBundleCsp, normalizeBundleNetworkMode } from "../security/bundleCsp";
import { generateNonce } from "../security/nonce";
import { guessContentType } from "../runtime/mime";
import { checkPublicRateLimit, getClientIp } from "../rateLimit";
import { json } from "../lib/responses";

type ArtifactRow = {
  id: string;
  owner_id?: string | null;
  type: string;
  runtime_version?: string | null;
  status: string;
  policy_status: string;
  visibility: string;
};

type ArtifactManifestRow = {
  manifest_json: string;
  version: number;
  runtime_version?: string | null;
};

type LoadedRuntimeManifest = {
  artifact: ArtifactRow;
  manifest: RuntimeManifest;
  version: number;
  runtimeVersion: string | null;
};

async function loadRuntimeManifestForArtifact(
  env: Env,
  artifactId: string
): Promise<{ ok: true; data: LoadedRuntimeManifest } | { ok: false; response: Response }> {
  const artifact = (await env.DB.prepare(
    "SELECT id, owner_id, type, runtime_version, status, policy_status, visibility FROM artifacts WHERE id = ? LIMIT 1"
  )
    .bind(artifactId)
    .first()) as ArtifactRow | null;

  if (!artifact) {
    return { ok: false, response: json({ error: "Artifact not found" }, 404) };
  }

  if (
    artifact.status !== "active" ||
    artifact.policy_status !== "active" ||
    (artifact.visibility !== "public" && artifact.visibility !== "unlisted")
  ) {
    return { ok: false, response: json({ error: "Artifact not available" }, 404) };
  }

  const manifestRow = (await env.DB.prepare(
    "SELECT manifest_json, version, runtime_version FROM artifact_manifests WHERE artifact_id = ? ORDER BY version DESC LIMIT 1"
  )
    .bind(artifactId)
    .first()) as ArtifactManifestRow | null;

  if (!manifestRow) {
    return { ok: false, response: json({ error: "Runtime manifest not found" }, 404) };
  }

  let manifestJson: string | null = null;

  if (env.RUNTIME_MANIFEST_KV) {
    try {
      const kvKey = `artifacts/${artifactId}/v1/runtime-manifest.json`;
      const kvValue = await env.RUNTIME_MANIFEST_KV.get(kvKey);
      if (typeof kvValue === "string" && kvValue.length > 0) {
        manifestJson = kvValue;
      }
    } catch (kvErr) {
      console.error(`${ERROR_RUNTIME_MANIFEST_KV_UNAVAILABLE} runtime manifest KV read failed`, {
        artifactId,
        error: kvErr instanceof Error ? kvErr.message : String(kvErr),
      });
    }
  }

  if (manifestJson === null) {
    manifestJson = String(manifestRow.manifest_json || "");
  }

  let manifest: RuntimeManifest;
  try {
    manifest = JSON.parse(manifestJson) as RuntimeManifest;
  } catch (err) {
    console.error(`${ERROR_RUNTIME_MANIFEST_PARSE_FAILED} artifact runtime manifest parse failed`, {
      artifactId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      response: json(
        {
          error: "Failed to load runtime manifest",
          code: ERROR_RUNTIME_MANIFEST_PARSE_FAILED,
        },
        500
      ),
    };
  }

  const runtimeVersion =
    artifact.runtime_version || manifestRow.runtime_version || manifest.runtime?.version || null;
  return {
    ok: true,
    data: {
      artifact,
      manifest,
      version: manifestRow.version,
      runtimeVersion,
    },
  };
}

type AuthedHandler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  user: AuthenticatedUser
) => Promise<Response>;

const createArtifactUploadHandler: AuthedHandler = async (req, env, _ctx, _params, user) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const payload = body as {
    type?: string;
    capsuleId?: string | null;
    estimatedSizeBytes?: number | null;
  };

  const rawType = typeof payload.type === "string" ? payload.type.trim() : "";
  const capsuleId = typeof payload.capsuleId === "string" ? payload.capsuleId.trim() : "";
  const estimatedSize =
    typeof payload.estimatedSizeBytes === "number" && payload.estimatedSizeBytes > 0
      ? Math.floor(payload.estimatedSizeBytes)
      : null;

  if (!rawType) {
    return json({ error: "type is required" }, 400);
  }

  let type: RuntimeArtifactType | null = null;
  for (const candidate of RUNTIME_ARTIFACT_TYPES) {
    if (candidate === rawType) {
      type = candidate;
      break;
    }
  }

  if (!type) {
    return json({ error: "Invalid artifact type" }, 400);
  }

  if (!capsuleId) {
    return json({ error: "capsuleId is required" }, 400);
  }

  const plan = await getUserPlan(user.userId, env);

  if (estimatedSize !== null) {
    const sizeCheck = checkBundleSize(plan, estimatedSize);
    if (!sizeCheck.allowed) {
      return json(
        {
          error: "Estimated bundle too large",
          reason: sizeCheck.reason,
          limits: sizeCheck.limits,
        },
        400
      );
    }

    const currentUsage = await getUserStorageUsage(user.userId, env);
    const storageCheck = checkStorageQuota(plan, currentUsage, estimatedSize);
    if (!storageCheck.allowed) {
      return json(
        {
          error: "Storage quota exceeded",
          reason: storageCheck.reason,
          limits: storageCheck.limits,
        },
        400
      );
    }
  }

  const { results: capsuleResults } = await env.DB.prepare(
    "SELECT id, owner_id FROM capsules WHERE id = ? LIMIT 1"
  )
    .bind(capsuleId)
    .all();

  const capsule = (capsuleResults && capsuleResults[0]) as { id: string; owner_id: string } | undefined;

  if (!capsule) {
    return json({ error: "Capsule not found" }, 404);
  }

  if (capsule.owner_id !== user.userId) {
    return json({ error: "Forbidden" }, 403);
  }

  const artifactId = crypto.randomUUID();
  const uploadKey = `artifacts/${artifactId}/v1/sources.tar`;
  const placeholderDigest = `pending:${artifactId}`;

  await env.DB.prepare(
    "INSERT INTO artifacts (id, owner_id, capsule_id, type, runtime_version, bundle_digest, status, visibility, policy_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      artifactId,
      user.userId,
      capsuleId,
      type,
      null,
      placeholderDigest,
      "draft",
      "private",
      "active"
    )
    .run();

  await invalidateLatestArtifactCache(env, capsuleId);

  return json(
    {
      ok: true,
      artifactId,
      upload: {
        method: "PUT",
        url: `/api/artifacts/${artifactId}/sources`,
        key: uploadKey,
        estimatedSizeBytes: estimatedSize,
      },
    },
    201
  );
};

const uploadArtifactSourcesHandler: AuthedHandler = async (req, env, _ctx, params, user) => {
  const artifactId = params.p1;
  if (!artifactId) {
    return json({ error: "artifactId is required" }, 400);
  }

  const { results } = await env.DB.prepare(
    "SELECT id, owner_id, capsule_id FROM artifacts WHERE id = ? LIMIT 1"
  )
    .bind(artifactId)
    .all();

  const artifact = (results && results[0]) as { id: string; owner_id: string; capsule_id?: string | null } | undefined;

  if (!artifact) {
    return json({ error: "Artifact not found" }, 404);
  }

  if (artifact.owner_id !== user.userId) {
    return json({ error: "Forbidden" }, 403);
  }

  const body = await req.arrayBuffer();
  const size = body.byteLength;

  const plan = await getUserPlan(user.userId, env);
  const sizeCheck = checkBundleSize(plan, size);
  if (!sizeCheck.allowed) {
    return json(
      {
        error: "Bundle size limit exceeded",
        reason: sizeCheck.reason,
        limits: sizeCheck.limits,
      },
      400
    );
  }

  const currentUsage = await getUserStorageUsage(user.userId, env);
  const storageCheck = checkStorageQuota(plan, currentUsage, size);
  if (!storageCheck.allowed) {
    return json(
      {
        error: "Storage quota exceeded",
        reason: storageCheck.reason,
        limits: storageCheck.limits,
      },
      400
    );
  }

  const key = `artifacts/${artifactId}/v1/sources.tar`;
  const contentType = req.headers.get("content-type") || "application/octet-stream";

  await env.R2.put(key, body, {
    httpMetadata: {
      contentType,
    },
  });

  return json({ ok: true, artifactId, size }, 201);
};

const completeArtifactHandler: AuthedHandler = async (req, env, _ctx, params, user) => {
  const artifactId = params.p1;
  if (!artifactId) {
    return json({ error: "artifactId is required" }, 400);
  }

  const { results } = await env.DB.prepare(
    "SELECT id, owner_id, capsule_id, type FROM artifacts WHERE id = ? LIMIT 1"
  )
    .bind(artifactId)
    .all();

  const artifact = (results && results[0]) as
    | { id: string; owner_id: string; capsule_id?: string | null; type: RuntimeArtifactType }
    | undefined;

  if (!artifact) {
    return json({ error: "Artifact not found" }, 404);
  }

  if (artifact.owner_id !== user.userId) {
    return json({ error: "Forbidden" }, 403);
  }

  const runQuota = await getUserRunQuotaState(user.userId, env);
  if (!runQuota.result.allowed) {
    return json(
      {
        error: "Run quota exceeded",
        reason: runQuota.result.reason,
        limits: runQuota.result.limits,
        usage: runQuota.result.usage,
      },
      429
    );
  }

  try {
    const ns = env.ARTIFACT_COMPILER_DURABLE;
    const id = ns.idFromName(artifactId);
    const stub = ns.get(id);
    const payload = { artifactId };

    const doRes = await stub.fetch("https://internal/artifact-compiler/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!doRes.ok) {
      let bodyText: string | undefined;
      try {
        bodyText = await doRes.text();
      } catch (error) {
        console.error("E-VIBECODR-1106 artifact compile error body read failed", {
          artifactId,
          status: doRes.status,
          error: error instanceof Error ? error.message : String(error),
        });
        bodyText = undefined;
      }

      console.error("artifact compile enqueue failed", {
        artifactId,
        status: doRes.status,
        body: bodyText,
      });

      return json(
        {
          error: "Failed to enqueue artifact compile",
        },
        502
      );
    }

    if (artifact.capsule_id) {
      await invalidateLatestArtifactCache(env, artifact.capsule_id);
    }

    return json(
      {
        ok: true,
        artifactId,
        queued: true,
      },
      202
    );
  } catch (err) {
    console.error("artifact compile request failed", {
      artifactId,
      userId: user.userId,
      error: err instanceof Error ? err.message : String(err),
    });

    return json(
      {
        error: "Failed to enqueue artifact compile",
      },
      500
    );
  }
};

export const createArtifactUpload: Handler = requireAuth(createArtifactUploadHandler);
export const uploadArtifactSources: Handler = requireAuth(uploadArtifactSourcesHandler);
export const completeArtifact: Handler = requireAuth(completeArtifactHandler);

export const getArtifactManifest: Handler = async (req, env, _ctx, params) => {
  const artifactId = params.p1;
  if (!artifactId) {
    return json({ error: "artifactId is required" }, 400);
  }

  const clientIp = getClientIp(req);
  const rate = await checkPublicRateLimit(env, `artifact-manifest:${clientIp ?? "unknown"}`, 120);
  if (!rate.allowed) {
    const retryAfter = rate.resetAt ? Math.ceil((rate.resetAt - Date.now()) / 1000) : 60;
    return json(
      { error: "Rate limit exceeded", code: "E-VIBECODR-0312", scope: "artifact-manifest" },
      429,
      {
        headers: {
          "Retry-After": retryAfter.toString(),
          "X-RateLimit-Limit": "120",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": rate.resetAt ? Math.floor(rate.resetAt / 1000).toString() : "",
        },
      }
    );
  }

  try {
    const manifestResult = await loadRuntimeManifestForArtifact(env, artifactId);
    if (!manifestResult.ok) {
      return manifestResult.response;
    }

    const { artifact, manifest, runtimeVersion, version } = manifestResult.data;
    const cspNonce = generateNonce();
    const manifestWithNonce = { ...manifest, cspNonce };

    return json({
      artifactId,
      type: artifact.type,
      runtimeVersion,
      version,
      manifest: manifestWithNonce,
    });
  } catch (error) {
    console.error(`${ERROR_RUNTIME_MANIFEST_LOAD_FAILED} getArtifactManifest failed`, {
      artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json(
      {
        error: "Failed to load runtime manifest",
        code: ERROR_RUNTIME_MANIFEST_LOAD_FAILED,
      },
      500
    );
  }
};

export const getArtifactBundle: Handler = async (_req, env, _ctx, params) => {
  const artifactId = params.p1;
  if (!artifactId) {
    return json({ error: "artifactId is required" }, 400);
  }

  const clientIp = getClientIp(_req);
  const rate = await checkPublicRateLimit(env, `artifact-bundle:${clientIp ?? "unknown"}`, 120);
  if (!rate.allowed) {
    const retryAfter = rate.resetAt ? Math.ceil((rate.resetAt - Date.now()) / 1000) : 60;
    return json(
      { error: "Rate limit exceeded", code: "E-VIBECODR-0312", scope: "artifact-bundle" },
      429,
      {
        headers: {
          "Retry-After": retryAfter.toString(),
          "X-RateLimit-Limit": "120",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": rate.resetAt ? Math.floor(rate.resetAt / 1000).toString() : "",
        },
      }
    );
  }

  const manifestResult = await loadRuntimeManifestForArtifact(env, artifactId);
  if (!manifestResult.ok) {
    console.log("BUNDLE_REQUEST_MANIFEST_FAILED", {
      artifactId,
    });
    return manifestResult.response;
  }

  const { artifact, manifest, runtimeVersion } = manifestResult.data;

  // DEBUG: Log bundle request details for troubleshooting ZIP → runtime issues
  console.log("BUNDLE_REQUEST", {
    artifactId,
    type: artifact.type,
    policy_status: artifact.policy_status,
    visibility: artifact.visibility,
    status: artifact.status,
    runtime_version: runtimeVersion,
    manifestType: manifest.type,
    bundleKey: manifest.bundle?.r2Key,
  });

  const bundleKey = manifest.bundle?.r2Key;
  if (!bundleKey || typeof bundleKey !== "string") {
    console.error("BUNDLE_REQUEST_MISSING_KEY", {
      artifactId,
      type: artifact.type,
      bundleKey,
    });
    return json(
      {
        error: "Runtime bundle reference missing",
        code: "E-VIBECODR-0504",
      },
      500
    );
  }

  const object = await env.R2.get(bundleKey);
  if (!object) {
    console.error("BUNDLE_REQUEST_R2_NOT_FOUND", {
      artifactId,
      type: artifact.type,
      bundleKey,
    });
    return json(
      {
        error: "Runtime bundle not found",
        code: "E-VIBECODR-0505",
      },
      404
    );
  }

  const storedContentType =
    object.httpMetadata && typeof object.httpMetadata.contentType === "string"
      ? object.httpMetadata.contentType
      : undefined;
  const contentType = storedContentType || guessContentType(bundleKey);
  const bundleMode = normalizeBundleNetworkMode(env.CAPSULE_BUNDLE_NETWORK_MODE);
  const cspHeader = buildBundleCsp(bundleMode);
  const artifactHeader = manifest.artifactId ? String(manifest.artifactId) : artifactId;

  // DEBUG: Log final bundle response details
  console.log("BUNDLE_RESPONSE", {
    artifactId,
    type: artifact.type,
    contentType,
    storedContentType,
    bundleMode,
    bundleSizeBytes: object.size,
  });

  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Runtime-Artifact": artifactHeader,
      "X-Runtime-Version": runtimeVersion || "",
      "X-Runtime-Type": artifact.type,
      "Content-Security-Policy": cspHeader,
      // WHY: Sandboxed iframes using srcdoc have origin 'null'.
      // CORS must allow this for HTML bundle fetch to work.
      "Access-Control-Allow-Origin": "*",
    },
  });
};
