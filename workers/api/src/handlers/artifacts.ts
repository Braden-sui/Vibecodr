import type { Env, Handler } from "../index";
import { requireAuth, type AuthenticatedUser } from "../auth";
import { getUserPlan, getUserStorageUsage, checkBundleSize, checkStorageQuota } from "../storage/quotas";
import { RUNTIME_ARTIFACT_TYPES, type RuntimeArtifactType } from "../runtime/runtimeManifest";
import {
  ERROR_RUNTIME_MANIFEST_KV_UNAVAILABLE,
  ERROR_RUNTIME_MANIFEST_LOAD_FAILED,
  ERROR_RUNTIME_MANIFEST_PARSE_FAILED,
} from "@vibecodr/shared";

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init,
  });
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
    "SELECT id, owner_id FROM artifacts WHERE id = ? LIMIT 1"
  )
    .bind(artifactId)
    .all();

  const artifact = (results && results[0]) as { id: string; owner_id: string } | undefined;

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
    "SELECT id, owner_id FROM artifacts WHERE id = ? LIMIT 1"
  )
    .bind(artifactId)
    .all();

  const artifact = (results && results[0]) as { id: string; owner_id: string } | undefined;

  if (!artifact) {
    return json({ error: "Artifact not found" }, 404);
  }

  if (artifact.owner_id !== user.userId) {
    return json({ error: "Forbidden" }, 403);
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
      } catch {
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

  try {
    const { results: artifactResults } = await env.DB.prepare(
      "SELECT id, type, runtime_version, status, policy_status, visibility FROM artifacts WHERE id = ? LIMIT 1"
    )
      .bind(artifactId)
      .all();

    const artifact = (artifactResults && artifactResults[0]) as
      | {
          id: string;
          type: string;
          runtime_version?: string | null;
          status: string;
          policy_status: string;
          visibility: string;
        }
      | undefined;

    if (!artifact) {
      return json({ error: "Artifact not found" }, 404);
    }

    if (
      artifact.status !== "active" ||
      artifact.policy_status !== "active" ||
      (artifact.visibility !== "public" && artifact.visibility !== "unlisted")
    ) {
      return json({ error: "Artifact not available" }, 404);
    }

    const { results: manifestResults } = await env.DB.prepare(
      "SELECT manifest_json, version, runtime_version FROM artifact_manifests WHERE artifact_id = ? ORDER BY version DESC LIMIT 1"
    )
      .bind(artifactId)
      .all();

    const manifestRow = (manifestResults && manifestResults[0]) as
      | { manifest_json: string; version: number; runtime_version?: string | null }
      | undefined;

    if (!manifestRow) {
      return json({ error: "Runtime manifest not found" }, 404);
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

    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestJson);
    } catch (err) {
      console.error(`${ERROR_RUNTIME_MANIFEST_PARSE_FAILED} artifact runtime manifest parse failed`, {
        artifactId,
        error: err instanceof Error ? err.message : String(err),
      });
      return json(
        {
          error: "Failed to load runtime manifest",
          code: ERROR_RUNTIME_MANIFEST_PARSE_FAILED,
        },
        500
      );
    }

    return json({
      artifactId,
      type: artifact.type,
      runtimeVersion: artifact.runtime_version || manifestRow.runtime_version || null,
      version: manifestRow.version,
      manifest,
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
