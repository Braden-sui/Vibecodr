import type { Env } from "../index";
import { validateManifest, type Manifest } from "@vibecodr/shared/manifest";
import { requireCapsuleManifest } from "../capsule-manifest";
import {
  uploadCapsuleBundle,
  verifyCapsuleIntegrity,
  getCapsuleMetadata,
  type CapsuleFile,
} from "../storage/r2";
import {
  getUserPlan,
  getUserStorageUsage,
  checkBundleSize,
  checkStorageQuota,
} from "../storage/quotas";
import { requireAuth, type AuthenticatedUser } from "../auth";
import { incrementUserCounters } from "./counters";
import { buildRuntimeManifest, type RuntimeArtifactType } from "../runtime/runtimeManifest";
import { compileHtmlArtifact } from "../runtime/compileHtmlArtifact";

type Handler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  user?: AuthenticatedUser
) => Promise<Response>;

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/**
 * POST /capsules/publish
 * Publish a complete capsule bundle to R2 and create D1 record
 * Based on mvp-plan.md Phase 2 Publish flow
 */
export const publishCapsule: Handler = requireAuth(async (req, env, ctx, params, user) => {
  try {
    // Parse multipart form data
    const formData = await req.formData();

    // Get manifest
    const manifestEntry = formData.get("manifest");
    if (!manifestEntry || typeof (manifestEntry as any).text !== "function") {
      return json({ error: "Missing manifest file" }, 400);
    }

    const manifestFile = manifestEntry as unknown as File;
    const manifestText = await manifestFile.text();
    const manifestData = JSON.parse(manifestText);

    // Validate manifest
    const validation = validateManifest(manifestData);
    if (!validation.valid) {
      return json(
        {
          error: "Invalid manifest",
          errors: validation.errors,
          warnings: validation.warnings,
        },
        400
      );
    }

    const manifest = manifestData as Manifest;

    // Collect all files
    const files: CapsuleFile[] = [];
    let totalSize = 0;

    for (const [key, value] of (formData as any)) {
      if (key === "manifest") continue; // Already processed

      const fileLike = value as any;
      if (fileLike && typeof fileLike.arrayBuffer === "function") {
        const content = await fileLike.arrayBuffer();
        const size = content.byteLength;
        totalSize += size;

        files.push({
          path: key,
          content,
          contentType: (fileLike.type as string) || "application/octet-stream",
          size,
        });
      }
    }

    // Add manifest to files
    const manifestBytes = new TextEncoder().encode(manifestText);
    const manifestContent = manifestBytes.buffer as ArrayBuffer;
    files.push({
      path: "manifest.json",
      content: manifestContent,
      contentType: "application/json",
      size: manifestBytes.byteLength,
    });
    totalSize += manifestBytes.byteLength;

    // HTML entry sanitization: run compileHtmlArtifact before quota checks and upload.
    const entryPath = manifest.entry;
    const entryFile = files.find((f) => f.path === entryPath);
    const isHtmlEntry =
      typeof entryPath === "string" &&
      (entryPath.toLowerCase().endsWith(".html") || entryPath.toLowerCase().endsWith(".htm"));

    if (entryFile && isHtmlEntry) {
      const decoder = new TextDecoder();
      const originalHtml =
        typeof entryFile.content === "string"
          ? entryFile.content
          : decoder.decode(entryFile.content as ArrayBuffer);

      const htmlResult = compileHtmlArtifact({ html: originalHtml });
      if (!htmlResult.ok) {
        return json(
          {
            error: "Invalid HTML artifact",
            code: htmlResult.errorCode,
            message: htmlResult.message,
            details: htmlResult.details,
          },
          400
        );
      }

      const encoder = new TextEncoder();
      const sanitizedBytes = encoder.encode(htmlResult.html);

      // Adjust total size to reflect sanitized entry content.
      totalSize -= entryFile.size;
      entryFile.content = sanitizedBytes.buffer as ArrayBuffer;
      entryFile.size = sanitizedBytes.byteLength;
      totalSize += entryFile.size;
    }

    // Check quotas
    const userPlan = await getUserPlan(user.userId, env);

    // Check bundle size
    const bundleSizeCheck = checkBundleSize(userPlan, totalSize);
    if (!bundleSizeCheck.allowed) {
      return json(
        {
          error: "Bundle size limit exceeded",
          reason: bundleSizeCheck.reason,
          bundleSize: totalSize,
          limit: bundleSizeCheck.limits?.maxBundleSize,
        },
        400
      );
    }

    // Check storage quota
    const currentUsage = await getUserStorageUsage(user.userId, env);
    const storageCheck = checkStorageQuota(userPlan, currentUsage, totalSize);
    if (!storageCheck.allowed) {
      return json(
        {
          error: "Storage quota exceeded",
          reason: storageCheck.reason,
          currentUsage,
          additionalSize: totalSize,
          limit: storageCheck.limits?.maxStorage,
        },
        400
      );
    }

    // Upload to R2
    const uploadResult = await uploadCapsuleBundle(
      env.R2,
      files,
      manifest,
      user.userId
    );

    // Verify integrity
    const integrityOk = await verifyCapsuleIntegrity(
      env.R2,
      uploadResult.contentHash,
      uploadResult.contentHash
    );

    if (!integrityOk) {
      return json({ error: "Integrity verification failed" }, 500);
    }

    // Create D1 record
    const capsuleId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO capsules (id, owner_id, manifest_json, hash, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(
        capsuleId,
        user.userId,
        manifestText,
        uploadResult.contentHash,
        Math.floor(Date.now() / 1000)
      )
      .run();

    // Create asset records
    for (const file of files) {
      await env.DB.prepare(
        "INSERT INTO assets (id, capsule_id, key, size) VALUES (?, ?, ?, ?)"
      )
        .bind(crypto.randomUUID(), capsuleId, file.path, file.size)
        .run();
    }

    if (
      env.RUNTIME_ARTIFACTS_ENABLED &&
      env.RUNTIME_ARTIFACTS_ENABLED !== "false" &&
      manifest.runner === "client-static"
    ) {
      try {
        const artifactId = crypto.randomUUID();

        const artifactType: RuntimeArtifactType =
          manifest.entry.toLowerCase().endsWith(".html") ||
          manifest.entry.toLowerCase().endsWith(".htm")
            ? "html"
            : "react-jsx";

        const runtimeVersion = "v0.1.0";
        const bundleR2Key = `capsules/${uploadResult.contentHash}/${manifest.entry}`;
        const entryFile = files.find((f) => f.path === manifest.entry);
        const bundleSizeBytes = entryFile?.size ?? uploadResult.totalSize;

        const runtimeManifest = buildRuntimeManifest({
          artifactId,
          type: artifactType,
          bundleKey: bundleR2Key,
          bundleSizeBytes,
          bundleDigest: uploadResult.contentHash,
          runtimeVersion,
        });

        const runtimeManifestJson = JSON.stringify(runtimeManifest);
        const runtimeManifestBytes = new TextEncoder().encode(runtimeManifestJson);
        const runtimeManifestSize = runtimeManifestBytes.byteLength;
        const runtimeManifestKey = `artifacts/${artifactId}/v1/runtime-manifest.json`;

        await env.R2.put(runtimeManifestKey, runtimeManifestJson, {
          httpMetadata: {
            contentType: "application/json",
          },
        });

        await env.DB.prepare(
          "INSERT INTO artifacts (id, owner_id, capsule_id, type, runtime_version, bundle_digest) VALUES (?, ?, ?, ?, ?, ?)"
        )
          .bind(
            artifactId,
            user.userId,
            capsuleId,
            artifactType,
            runtimeVersion,
            runtimeManifest.bundle.digest
          )
          .run();

        const artifactManifestId = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO artifact_manifests (id, artifact_id, version, manifest_json, size_bytes, runtime_version) VALUES (?, ?, ?, ?, ?, ?)"
        )
          .bind(
            artifactManifestId,
            artifactId,
            1,
            runtimeManifestJson,
            runtimeManifestSize,
            runtimeVersion
          )
          .run();

        if (env.RUNTIME_MANIFEST_KV) {
          try {
            const kvKey = `artifacts/${artifactId}/v1/runtime-manifest.json`;
            await env.RUNTIME_MANIFEST_KV.put(kvKey, runtimeManifestJson);
          } catch (kvErr) {
            console.error("runtime manifest KV write failed", {
              capsuleId,
              artifactId,
              userId: user.userId,
              error: kvErr instanceof Error ? kvErr.message : String(kvErr),
            });
          }
        }
      } catch (err) {
        console.error("artifact creation failed", {
          capsuleId,
          userId: user.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Optional remix tracking
    try {
      const parentCapsuleId = (formData.get("parentCapsuleId") || formData.get("remixOf")) as string | null;
      if (parentCapsuleId && parentCapsuleId.trim()) {
        await env.DB.prepare(
          "INSERT INTO remixes (child_capsule_id, parent_capsule_id) VALUES (?, ?)"
        ).bind(capsuleId, parentCapsuleId.trim()).run();

        // Increment user's remixes count best-effort
        incrementUserCounters(env, user.userId, { remixesDelta: 1 }).catch((err) => {
          console.error("E-API-0010 publishCapsule remixes counter failed", {
            userId: user.userId,
            capsuleId,
            parentCapsuleId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (err) {
      console.error("E-API-0011 publishCapsule remix insert failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return json({
      success: true,
      capsuleId,
      contentHash: uploadResult.contentHash,
      totalSize: uploadResult.totalSize,
      fileCount: uploadResult.fileCount,
      warnings: validation.warnings,
    });
  } catch (error) {
    console.error("Publish error:", error);
    return json(
      {
        error: "Failed to publish capsule",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * GET /capsules/:id
 * Get capsule details with integrity verification
 */
export const getCapsule: Handler = async (req, env, ctx, params) => {
  const capsuleId = params.p1;

  try {
    // Get from D1
    const { results } = await env.DB.prepare(
      "SELECT * FROM capsules WHERE id = ? LIMIT 1"
    )
      .bind(capsuleId)
      .all();

    if (!results || results.length === 0) {
      return json({ error: "Capsule not found" }, 404);
    }

    const capsule = results[0];
    const contentHash = capsule.hash as string;

    // Verify integrity
    const integrityOk = await verifyCapsuleIntegrity(
      env.R2,
      contentHash,
      contentHash
    );

    if (!integrityOk) {
      return json(
        {
          error: "Integrity verification failed",
          capsuleId,
          warning: "This capsule may have been tampered with",
        },
        500
      );
    }

    // Get metadata from R2
    const metadata = await getCapsuleMetadata(env.R2, contentHash);

    return json({
      id: capsule.id,
      ownerId: capsule.owner_id,
      manifest: requireCapsuleManifest(capsule.manifest_json, {
        source: "getCapsule",
        capsuleId,
      }),
      contentHash,
      createdAt: capsule.created_at,
      metadata,
      verified: true,
    });
  } catch (error) {
    return json(
      {
        error: "Failed to retrieve capsule",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
};

/**
 * GET /capsules/:id/verify
 * Verify capsule integrity without returning full data
 */
export const verifyCapsule: Handler = async (req, env, ctx, params) => {
  const capsuleId = params.p1;

  try {
    const { results } = await env.DB.prepare(
      "SELECT hash FROM capsules WHERE id = ? LIMIT 1"
    )
      .bind(capsuleId)
      .all();

    if (!results || results.length === 0) {
      return json({ error: "Capsule not found" }, 404);
    }

    const contentHash = results[0].hash as string;
    const verified = await verifyCapsuleIntegrity(env.R2, contentHash, contentHash);

    return json({
      capsuleId,
      contentHash,
      verified,
      timestamp: Date.now(),
    });
  } catch (error) {
    return json(
      {
        error: "Verification failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
};

/**
 * GET /user/quota
 * Get current user's quota usage and limits
 */
export const getUserQuota: Handler = requireAuth(async (req, env, ctx, params, user) => {
  try {
    const plan = await getUserPlan(user.userId, env);
    const storageUsage = await getUserStorageUsage(user.userId, env);

    // Get run count for current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const timestamp = Math.floor(startOfMonth.getTime() / 1000);

    const { results: runResults } = await env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM runs
      WHERE user_id = ? AND started_at >= ?
    `)
      .bind(user.userId, timestamp)
      .all();

    const runsThisMonth = (runResults?.[0]?.count as number) || 0;

    const limits = {
      free: {
        maxBundleSize: 25 * 1024 * 1024,
        maxRuns: 5_000,
        maxStorage: 1 * 1024 * 1024 * 1024,
      },
      creator: {
        maxBundleSize: 25 * 1024 * 1024,
        maxRuns: 50_000,
        maxStorage: 10 * 1024 * 1024 * 1024,
      },
      pro: {
        maxBundleSize: 100 * 1024 * 1024,
        maxRuns: 250_000,
        maxStorage: 50 * 1024 * 1024 * 1024,
      },
      team: {
        maxBundleSize: 250 * 1024 * 1024,
        maxRuns: 1_000_000,
        maxStorage: 250 * 1024 * 1024 * 1024,
      },
    };

    const planLimits = limits[plan];

    return json({
      plan,
      usage: {
        storage: storageUsage,
        runs: runsThisMonth,
        bundleSize: 0,
      },
      limits: planLimits,
      percentUsed: {
        storage: (storageUsage / planLimits.maxStorage) * 100,
        runs: (runsThisMonth / planLimits.maxRuns) * 100,
      },
    });
  } catch (error) {
    return json(
      {
        error: "Failed to get quota",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});
