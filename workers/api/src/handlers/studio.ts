import { requireAuth, type AuthenticatedUser } from "../auth";
import type { Env, Handler } from "../index";
import { requireCapsuleManifest } from "../capsule-manifest";
import { validateManifest, type Manifest } from "@vibecodr/shared/manifest";
import { getCapsuleKey, listCapsuleFiles } from "../storage/r2";
import { checkBundleSize, getUserPlan } from "../storage/quotas";
import { PublishCapsuleError } from "./capsules";
import { buildRuntimeManifest } from "../runtime/runtimeManifest";
import { bundleInlineJs } from "./inlineBundle";

type CapsuleRow = { id: string; owner_id: string; manifest_json: string; hash: string };

async function loadOwnedCapsule(env: Env, capsuleId: string, userId: string): Promise<CapsuleRow> {
  const { results } = await env.DB.prepare(
    "SELECT id, owner_id, manifest_json, hash FROM capsules WHERE id = ? LIMIT 1"
  )
    .bind(capsuleId)
    .all();
  const row = results?.[0] as CapsuleRow | undefined;
  if (!row) {
    throw new PublishCapsuleError(404, { error: "Capsule not found" });
  }
  if (row.owner_id !== userId) {
    throw new PublishCapsuleError(403, { error: "Forbidden" });
  }
  return row;
}

function totalAssetSize(rows: Array<{ size?: number }>): number {
  return rows.reduce((acc, row) => acc + (typeof row.size === "number" ? row.size : 0), 0);
}

const RUNTIME_ARTIFACT_VERSION = "v0.1.0";

async function hashUint8(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const getCapsuleFilesSummary: Handler = requireAuth(async (req, env, _ctx, params, user) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  const capsuleId = params.p1;
  if (!capsuleId) {
    return json({ error: "capsuleId required" }, 400);
  }

  try {
    const capsule = await loadOwnedCapsule(env, capsuleId, user.userId);
    const manifest = requireCapsuleManifest(capsule.manifest_json, { source: "filesSummary", capsuleId });
    const files = await listCapsuleFiles(env.R2, capsule.hash);
    const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);

    return json({
      capsuleId,
      contentHash: capsule.hash,
      manifest,
      files,
      totalSize,
      fileCount: files.length,
    });
  } catch (err) {
    if (err instanceof PublishCapsuleError) {
      return json(err.body, err.status);
    }
    return json({ error: err instanceof Error ? err.message : "Failed to fetch files" }, 500);
  }
});

export const getCapsuleFile: Handler = requireAuth(async (req, env, _ctx, params, user) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  const capsuleId = params.p1;
  const encodedPath = params.p2;
  if (!capsuleId || !encodedPath) {
    return json({ error: "capsuleId and path required" }, 400);
  }
  const path = decodeURIComponent(encodedPath);

  try {
    const capsule = await loadOwnedCapsule(env, capsuleId, user.userId);
    const key = getCapsuleKey(capsule.hash, path);
    const object = await env.R2.get(key);
    if (!object) {
      return json({ error: "File not found" }, 404);
    }
    const contentType = object.httpMetadata?.contentType || "application/octet-stream";
    return new Response(object.body, { status: 200, headers: { "content-type": contentType } });
  } catch (err) {
    if (err instanceof PublishCapsuleError) {
      return json(err.body, err.status);
    }
    return json({ error: err instanceof Error ? err.message : "Failed to fetch file" }, 500);
  }
});

export const updateCapsuleFile: Handler = requireAuth(async (req, env, _ctx, params, user) => {
  if (req.method !== "PUT") {
    return json({ error: "Method not allowed" }, 405);
  }
  const capsuleId = params.p1;
  const encodedPath = params.p2;
  if (!capsuleId || !encodedPath) {
    return json({ error: "capsuleId and path required" }, 400);
  }
  const path = decodeURIComponent(encodedPath);

  try {
    const capsule = await loadOwnedCapsule(env, capsuleId, user.userId);
    const body = await req.arrayBuffer();
    const contentType = req.headers.get("content-type") || "application/octet-stream";
    const size = body.byteLength;

    const plan = await getUserPlan(user.userId, env);
    const { results: assetRows } = await env.DB.prepare("SELECT size FROM assets WHERE capsule_id = ?").bind(capsuleId).all();
    const totalBefore = totalAssetSize(assetRows || []);

    const existing = await env.DB.prepare("SELECT size FROM assets WHERE capsule_id = ? AND key = ? LIMIT 1")
      .bind(capsuleId, path)
      .first<{ size?: number }>();
    const existingSize = existing?.size ?? 0;
    const nextTotal = totalBefore - existingSize + size;

    const sizeCheck = checkBundleSize(plan, nextTotal);
    if (!sizeCheck.allowed) {
      return json(
        { error: "Bundle size limit exceeded", reason: sizeCheck.reason, plan, limits: sizeCheck.limits, usage: { bundleSize: nextTotal } },
        400
      );
    }

    const key = getCapsuleKey(capsule.hash, path);
    await env.R2.put(key, body, { httpMetadata: { contentType } });

    if (existing) {
      await env.DB.prepare("UPDATE assets SET size = ? WHERE capsule_id = ? AND key = ?").bind(size, capsuleId, path).run();
    } else {
      await env.DB.prepare("INSERT INTO assets (id, capsule_id, key, size) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), capsuleId, path, size)
        .run();
    }

    return json({ ok: true, path, size, totalSize: nextTotal });
  } catch (err) {
    if (err instanceof PublishCapsuleError) {
      return json(err.body, err.status);
    }
    return json({ error: err instanceof Error ? err.message : "Failed to update file" }, 500);
  }
});

export const updateCapsuleManifest: Handler = requireAuth(async (req, env, _ctx, params, user) => {
  if (req.method !== "PATCH") {
    return json({ error: "Method not allowed" }, 405);
  }
  const capsuleId = params.p1;
  if (!capsuleId) {
    return json({ error: "capsuleId required" }, 400);
  }

  try {
    await loadOwnedCapsule(env, capsuleId, user.userId);
    const payload = await req.json();
    const validation = validateManifest(payload);
    if (!validation.valid) {
      return json({ error: "Invalid manifest", errors: validation.errors, warnings: validation.warnings }, 400);
    }

    const manifestText = JSON.stringify(payload);
    await env.DB.prepare("UPDATE capsules SET manifest_json = ? WHERE id = ?").bind(manifestText, capsuleId).run();

    return json({ ok: true, capsuleId, warnings: validation.warnings });
  } catch (err) {
    if (err instanceof PublishCapsuleError) {
      return json(err.body, err.status);
    }
    return json({ error: err instanceof Error ? err.message : "Failed to update manifest" }, 500);
  }
});

export const compileDraftArtifact: Handler = requireAuth(async (req, env, _ctx, params, user) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const capsuleId = params.p1;
  if (!capsuleId) {
    return json({ error: "capsuleId required" }, 400);
  }

  try {
    const capsule = await loadOwnedCapsule(env, capsuleId, user.userId);
    const manifest = requireCapsuleManifest(capsule.manifest_json, { source: "compileDraft", capsuleId });

    const artifactId = crypto.randomUUID();
    const entryKey = getCapsuleKey(capsule.hash, manifest.entry);
    const entryObj = await env.R2.get(entryKey);
    if (!entryObj) {
      return json({ error: "Entry file missing for draft" }, 404);
    }

    let bundleKey = entryKey;
    let bundleSizeBytes = 0;
    let bundleDigest = "";

    if (manifest.entry.toLowerCase().endsWith(".html") || manifest.entry.toLowerCase().endsWith(".htm")) {
      const entryBytes = new Uint8Array(await entryObj.arrayBuffer());
      bundleDigest = await hashUint8(entryBytes);
      bundleSizeBytes = entryBytes.byteLength;
    } else {
      // Gather all capsule files for bundling
      const files = await listCapsuleFiles(env.R2, capsule.hash);
      const sourceFiles = new Map<string, Uint8Array>();
      for (const f of files) {
        const obj = await env.R2.get(getCapsuleKey(capsule.hash, f.path));
        if (!obj) continue;
        const bytes = new Uint8Array(await obj.arrayBuffer());
        sourceFiles.set(f.path, bytes);
      }
      const bundled = await bundleInlineJs(sourceFiles, manifest.entry);
      bundleKey = `artifacts/${artifactId}/bundle.js`;
      bundleSizeBytes = bundled.content.byteLength;
      bundleDigest = await hashUint8(bundled.content);
      await env.R2.put(bundleKey, bundled.content, { httpMetadata: { contentType: "application/javascript" } });
    }

    await env.DB.prepare(
      "INSERT INTO artifacts (id, owner_id, capsule_id, type, runtime_version, bundle_digest, status, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        artifactId,
        user.userId,
        capsuleId,
        manifest.runner === "client-static" ? "html" : "react-jsx",
        RUNTIME_ARTIFACT_VERSION,
        bundleDigest,
        "draft",
        "private"
      )
      .run();

    const runtimeManifest = buildRuntimeManifest({
      artifactId,
      type: manifest.runner === "client-static" ? "html" : "react-jsx",
      bundleKey,
      bundleSizeBytes,
      bundleDigest,
      runtimeVersion: RUNTIME_ARTIFACT_VERSION,
    });
    const runtimeManifestJson = JSON.stringify(runtimeManifest);
    const runtimeManifestSize = new TextEncoder().encode(runtimeManifestJson).byteLength;
    const artifactManifestId = crypto.randomUUID();

    await env.DB.prepare(
      "INSERT INTO artifact_manifests (id, artifact_id, version, manifest_json, size_bytes, runtime_version) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(artifactManifestId, artifactId, 1, runtimeManifestJson, runtimeManifestSize, RUNTIME_ARTIFACT_VERSION)
      .run();

    await env.R2.put(`artifacts/${artifactId}/v1/runtime-manifest.json`, runtimeManifestJson, {
      httpMetadata: { contentType: "application/json" },
    });

    return json({
      ok: true,
      artifactId,
      runtimeVersion: RUNTIME_ARTIFACT_VERSION,
      bundleKey: runtimeManifest.bundle.r2Key,
      bundleDigest,
      bundleSizeBytes,
    });
  } catch (err) {
    if (err instanceof PublishCapsuleError) {
      return json(err.body, err.status);
    }
    return json({ error: err instanceof Error ? err.message : "Failed to compile draft" }, 500);
  }
});

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
