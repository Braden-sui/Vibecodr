import type { Env } from "../index";
import { validateManifest, type Manifest } from "@vibecodr/shared/manifest";
import { requireCapsuleManifest } from "../capsule-manifest";
import {
  uploadCapsuleBundle,
  verifyCapsuleIntegrity,
  getCapsuleMetadata,
  deleteCapsuleBundle,
  type CapsuleFile,
} from "../storage/r2";
import {
  getUserPlan,
  getUserStorageUsage,
  getUserStorageState,
  checkBundleSize,
  checkStorageQuota,
  Plan,
} from "../storage/quotas";
import { requireAuth, type AuthenticatedUser } from "../auth";
import { incrementUserCounters } from "./counters";
import { buildRuntimeManifest, type RuntimeArtifactType } from "../runtime/runtimeManifest";
import { compileHtmlArtifact } from "../runtime/compileHtmlArtifact";
import { recordBundleWarningMetrics } from "../runtime/bundleTelemetry";
import { hashCode, logSafetyVerdict, runSafetyCheck } from "../safety/safetyClient";
import { bundleInlineJs } from "./inlineBundle";

async function hashUint8(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type PublishWarning = { path: string; message: string };

export class PublishCapsuleError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(body?.error ? String(body.error) : "publish_capsule_error");
    this.status = status;
    this.body = body;
  }
}

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

    try {
      await enforceSafetyForFiles(env, manifest, files);
    } catch (err) {
      if (err instanceof PublishCapsuleError) {
        return json(err.body, err.status);
      }
      throw err;
    }

    let publishResult:
      | {
          capsule: { id: string; contentHash: string; totalSize: number; fileCount: number };
          warnings?: PublishWarning[];
          artifact?: {
            id: string;
            runtimeVersion?: string | null;
            bundleDigest?: string | null;
            bundleSizeBytes?: number | null;
            queued?: boolean;
          } | null;
        }
      | undefined;
    try {
      const sanitized = sanitizeHtmlEntryIfNeeded(files, manifest);
      publishResult = await persistCapsuleBundle({
        env,
        user,
        manifest,
        manifestText,
        files: sanitized.files,
        totalSize: sanitized.totalSize,
        warnings: validation.warnings,
      });
    } catch (err) {
      if (err instanceof PublishCapsuleError) {
        return json(err.body, err.status);
      }
      throw err;
    }

    // Optional remix tracking
    try {
      const parentCapsuleId = (formData.get("parentCapsuleId") || formData.get("remixOf")) as string | null;
      if (parentCapsuleId && parentCapsuleId.trim()) {
        await env.DB.prepare(
          "INSERT INTO remixes (child_capsule_id, parent_capsule_id) VALUES (?, ?)"
        )
          .bind(publishResult.capsule.id, parentCapsuleId.trim())
          .run();

        // Increment user's remixes count best-effort
        incrementUserCounters(env, user.userId, { remixesDelta: 1 }).catch((err) => {
          console.error("E-API-0010 publishCapsule remixes counter failed", {
            userId: user.userId,
            capsuleId: publishResult?.capsule.id,
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
      capsuleId: publishResult.capsule.id,
      contentHash: publishResult.capsule.contentHash,
      totalSize: publishResult.capsule.totalSize,
      fileCount: publishResult.capsule.fileCount,
      warnings: publishResult.warnings,
      capsule: publishResult.capsule,
      artifact: publishResult.artifact,
      artifactId: publishResult.artifact?.id ?? null,
      bundleDigest: publishResult.artifact?.bundleDigest ?? null,
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

type PersistCapsuleResult = {
  capsule: {
    id: string;
    contentHash: string;
    totalSize: number;
    fileCount: number;
  };
  warnings?: PublishWarning[];
  artifact?: {
    id: string;
    runtimeVersion?: string | null;
    bundleDigest?: string | null;
    bundleSizeBytes?: number | null;
    queued?: boolean;
  } | null;
};

type PersistCapsuleInput = {
  env: Env;
  user: AuthenticatedUser;
  manifest: Manifest;
  manifestText: string;
  files: CapsuleFile[];
  totalSize: number;
  warnings?: PublishWarning[];
};

export function sanitizeHtmlEntryIfNeeded(
  files: CapsuleFile[],
  manifest: Manifest
): { files: CapsuleFile[]; totalSize: number } {
  const entryPath = manifest.entry;
  const entryFile = files.find((f) => f.path === entryPath);
  const isHtmlEntry =
    typeof entryPath === "string" &&
    (entryPath.toLowerCase().endsWith(".html") || entryPath.toLowerCase().endsWith(".htm"));

  let totalSize = files.reduce((acc, file) => acc + file.size, 0);

  if (entryFile && isHtmlEntry) {
    const decoder = new TextDecoder();
    const originalHtml =
      typeof entryFile.content === "string"
        ? entryFile.content
        : decoder.decode(entryFile.content as ArrayBuffer);

    const htmlResult = compileHtmlArtifact({ html: originalHtml });
    if (!htmlResult.ok) {
      throw new PublishCapsuleError(400, {
        error: "Invalid HTML artifact",
        code: htmlResult.errorCode,
        message: htmlResult.message,
        details: htmlResult.details,
      });
    }

    const encoder = new TextEncoder();
    const sanitizedBytes = encoder.encode(htmlResult.html);
    totalSize -= entryFile.size;
    entryFile.content = sanitizedBytes.buffer as ArrayBuffer;
    entryFile.size = sanitizedBytes.byteLength;
    totalSize += entryFile.size;
  }

  return { files, totalSize };
}

export async function enforceSafetyForFiles(env: Env, manifest: Manifest, files: CapsuleFile[]): Promise<void> {
  const decoder = new TextDecoder();
  for (const file of files) {
    if (file.path === "manifest.json") continue;
    const language = file.path.toLowerCase().endsWith(".html") || file.path.toLowerCase().endsWith(".htm") ? "html" : "javascript";
    const content =
      typeof file.content === "string"
        ? file.content
        : decoder.decode(file.content as ArrayBuffer);

    const codeHash = await hashCode(content);
    const verdict = await runSafetyCheck(env, {
      code: content,
      language,
      environment: "capsule",
    });

    logSafetyVerdict(env, {
      entryPath: file.path,
      codeHash,
      verdict,
    });

    if (!verdict.safe) {
      throw new PublishCapsuleError(403, {
        error: "Unsafe code detected",
        code: "E-VIBECODR-SECURITY-BLOCK",
        reasons: verdict.reasons,
        risk: verdict.risk_level,
        tags: verdict.tags,
        path: file.path,
      });
    }
  }
}

export async function persistCapsuleBundle(input: PersistCapsuleInput): Promise<PersistCapsuleResult> {
  const { env, user, manifest, manifestText, files, totalSize, warnings } = input;
  recordBundleWarningMetrics(env, warnings, "capsulePublish");

  const { plan, storageUsageBytes, storageVersion } = await getUserStorageState(user.userId, env);
  const sizeCheck = checkBundleSize(plan, totalSize);
  if (!sizeCheck.allowed) {
    throw new PublishCapsuleError(400, {
      error: "Bundle size limit exceeded",
      reason: sizeCheck.reason,
      bundleSize: totalSize,
      limit: sizeCheck.limits?.maxBundleSize,
    });
  }

  const storageCheck = checkStorageQuota(plan, storageUsageBytes, totalSize);
  if (!storageCheck.allowed) {
    throw new PublishCapsuleError(400, {
      error: "Storage quota exceeded",
      reason: storageCheck.reason,
      currentUsage: storageUsageBytes,
      additionalSize: totalSize,
      limit: storageCheck.limits?.maxStorage,
    });
  }

  const uploadResult = await uploadCapsuleBundle(env.R2, files, manifest, user.userId);
  const integrityOk = await verifyCapsuleIntegrity(env.R2, uploadResult.contentHash, uploadResult.contentHash);
  if (!integrityOk) {
    throw new PublishCapsuleError(500, { error: "Integrity verification failed" });
  }

  const capsuleId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO capsules (id, owner_id, manifest_json, hash, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(capsuleId, user.userId, manifestText, uploadResult.contentHash, Math.floor(Date.now() / 1000))
    .run();

  for (const file of files) {
    await env.DB.prepare("INSERT INTO assets (id, capsule_id, key, size) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), capsuleId, file.path, file.size)
      .run();
  }

  const cleanupFailedReservation = async () => {
    try {
      await env.DB.prepare("DELETE FROM assets WHERE capsule_id = ?").bind(capsuleId).run();
    } catch (err) {
      console.error("E-VIBECODR-0401 cleanup assets failed", {
        capsuleId,
        userId: user.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await env.DB.prepare("DELETE FROM capsules WHERE id = ?").bind(capsuleId).run();
    } catch (err) {
      console.error("E-VIBECODR-0402 cleanup capsule failed", {
        capsuleId,
        userId: user.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const { results } = await env.DB.prepare("SELECT COUNT(*) as count FROM capsules WHERE hash = ?")
        .bind(uploadResult.contentHash)
        .all();
      const referenceCount = Number(results?.[0]?.count ?? 0);

      if (referenceCount === 0) {
        await deleteCapsuleBundle(env.R2, uploadResult.contentHash);
      } else {
        console.info("E-VIBECODR-0404 skip R2 cleanup; bundle still referenced", {
          capsuleId,
          userId: user.userId,
          contentHash: uploadResult.contentHash,
          referenceCount,
        });
      }
    } catch (err) {
      console.error("E-VIBECODR-0403 cleanup R2 bundle failed", {
        capsuleId,
        userId: user.userId,
        contentHash: uploadResult.contentHash,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const storageReservationSql = `
    UPDATE users
    SET
      storage_usage_bytes = storage_usage_bytes + ?,
      storage_version = storage_version + 1
    WHERE id = ? AND storage_version = ?
    `;

  const storageUpdateResult = await env.DB.prepare(storageReservationSql)
    .bind(totalSize, user.userId, storageVersion)
    .run();

  let storageUpdates = storageUpdateResult?.meta?.changes ?? 0;

  if (storageUpdates === 0) {
    const abortReservation = async (error?: unknown) => {
      await cleanupFailedReservation();
      if (error) {
        throw error;
      }
      throw new PublishCapsuleError(409, {
        error: "Concurrent upload detected. Please retry.",
        code: "E-VIBECODR-CONCURRENT-UPLOAD",
      });
    };

    try {
      const existingUser = await env.DB.prepare(
        "SELECT storage_version FROM users WHERE id = ? LIMIT 1"
      )
        .bind(user.userId)
        .first<{ storage_version?: number }>();

      if (!existingUser) {
        const bootstrapOutcome = await bootstrapUserStorageAccount({
          env,
          user,
          plan,
          storageDelta: totalSize,
          nextVersion: Math.max(storageVersion, 0) + 1,
        });

        if (bootstrapOutcome === "inserted") {
          storageUpdates = 1;
        } else {
          const latestState = await getUserStorageState(user.userId, env);
          const retryResult = await env.DB.prepare(storageReservationSql)
            .bind(totalSize, user.userId, latestState.storageVersion)
            .run();
          storageUpdates = retryResult?.meta?.changes ?? 0;
        }
      }

      if (storageUpdates === 0) {
        await abortReservation();
      }
    } catch (err) {
      await abortReservation(err);
    }
  }

  let artifactSummary:
    | {
        id: string;
        runtimeVersion?: string | null;
        bundleDigest?: string | null;
        bundleSizeBytes?: number | null;
        queued?: boolean;
      }
    | null = null;

  if (
    env.RUNTIME_ARTIFACTS_ENABLED &&
    env.RUNTIME_ARTIFACTS_ENABLED !== "false" &&
    (manifest.runner === "client-static" || manifest.runner === "webcontainer")
  ) {
    try {
      const artifactId = crypto.randomUUID();
      const artifactType: RuntimeArtifactType =
        manifest.runner === "client-static"
          ? manifest.entry.toLowerCase().endsWith(".html") || manifest.entry.toLowerCase().endsWith(".htm")
            ? "html"
            : "react-jsx"
          : "react-jsx";
      const runtimeVersion = "v0.1.0";

      let bundleR2Key = `capsules/${uploadResult.contentHash}/${manifest.entry}`;
      let bundleDigest = uploadResult.contentHash;
      let bundleSizeBytes = uploadResult.totalSize;

      if (manifest.runner === "webcontainer") {
        const sourceFiles = new Map<string, Uint8Array>();
        for (const file of files) {
          if (file.path === "manifest.json") continue;
          const content =
            typeof file.content === "string" ? new TextEncoder().encode(file.content) : new Uint8Array(file.content as ArrayBuffer);
          sourceFiles.set(file.path, content);
        }

        const bundled = await bundleInlineJs(sourceFiles, manifest.entry);
        bundleR2Key = `artifacts/${artifactId}/bundle.js`;
        bundleSizeBytes = bundled.content.byteLength;
        bundleDigest = await hashUint8(bundled.content);

        await env.R2.put(bundleR2Key, bundled.content, {
          httpMetadata: { contentType: "application/javascript" },
        });
      } else {
        const entryFile = files.find((f) => f.path === manifest.entry);
        bundleSizeBytes = entryFile?.size ?? uploadResult.totalSize;
      }

      const runtimeManifest = buildRuntimeManifest({
        artifactId,
        type: artifactType,
        bundleKey: bundleR2Key,
        bundleSizeBytes,
        bundleDigest,
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
        .bind(artifactId, user.userId, capsuleId, artifactType, runtimeVersion, runtimeManifest.bundle.digest)
        .run();

      const artifactManifestId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO artifact_manifests (id, artifact_id, version, manifest_json, size_bytes, runtime_version) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(artifactManifestId, artifactId, 1, runtimeManifestJson, runtimeManifestSize, runtimeVersion)
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

      artifactSummary = {
        id: artifactId,
        runtimeVersion,
        bundleDigest: runtimeManifest.bundle.digest,
        bundleSizeBytes,
        queued: false,
      };
    } catch (err) {
      console.error("artifact creation failed", {
        capsuleId,
        userId: user.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    capsule: {
      id: capsuleId,
      contentHash: uploadResult.contentHash,
      totalSize: uploadResult.totalSize,
      fileCount: uploadResult.fileCount,
    },
    warnings,
    artifact: artifactSummary,
  };
}

type StorageBootstrapResult = "inserted" | "retry";
const HANDLE_MAX_LENGTH = 30;
const HANDLE_MIN_LENGTH = 3;

async function bootstrapUserStorageAccount(params: {
  env: Env;
  user: AuthenticatedUser;
  plan: Plan;
  storageDelta: number;
  nextVersion: number;
}): Promise<StorageBootstrapResult> {
  const { candidates, fallbackBase } = collectHandleCandidates(params.user);
  const maxAttempts = candidates.length + 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const handle = attempt < candidates.length ? candidates[attempt] : buildHandleVariant(fallbackBase);
    try {
      await params.env.DB.prepare(
        "INSERT INTO users (id, handle, plan, storage_usage_bytes, storage_version) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(
          params.user.userId,
          handle,
          params.plan,
          Math.max(0, params.storageDelta),
          Math.max(params.nextVersion, 1)
        )
        .run();
      return "inserted";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE constraint failed: users.id")) {
        return "retry";
      }
      if (message.includes("UNIQUE constraint failed: users.handle")) {
        continue;
      }

      console.error("E-VIBECODR-0410 bootstrap user storage failed", {
        userId: params.user.userId,
        error: message,
      });

      throw new PublishCapsuleError(500, {
        error: "Failed to initialize user storage",
        code: "E-VIBECODR-0410",
      });
    }
  }

  throw new PublishCapsuleError(500, {
    error: "Failed to allocate fallback handle for user",
    code: "E-VIBECODR-0411",
  });
}

function collectHandleCandidates(user: AuthenticatedUser): { candidates: string[]; fallbackBase: string } {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const claims = user.claims as Record<string, unknown> | undefined;
  const claimHandles = [
    claims && typeof (claims as any).username === "string" ? (claims as any).username : null,
    claims && typeof (claims as any).preferred_username === "string" ? (claims as any).preferred_username : null,
    claims && typeof (claims as any).handle === "string" ? (claims as any).handle : null,
    claims && (claims as any).public_metadata && typeof (claims as any).public_metadata.handle === "string"
      ? ((claims as any).public_metadata.handle as string)
      : null,
    claims && (claims as any).publicMetadata && typeof (claims as any).publicMetadata.handle === "string"
      ? ((claims as any).publicMetadata.handle as string)
      : null,
  ];

  for (const raw of claimHandles) {
    const sanitized = sanitizeHandleCandidate(raw);
    if (sanitized && !seen.has(sanitized)) {
      candidates.push(sanitized);
      seen.add(sanitized);
    }
  }

  const fallbackBase = buildFallbackHandleBase(user.userId);
  if (!seen.has(fallbackBase)) {
    candidates.push(fallbackBase);
  }

  return { candidates, fallbackBase };
}

function sanitizeHandleCandidate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  const stripped = normalized.replace(/^-+|-+$/g, "");
  const candidate = (stripped || normalized).slice(0, HANDLE_MAX_LENGTH);
  if (candidate.length < HANDLE_MIN_LENGTH) {
    return null;
  }
  return candidate;
}

function buildFallbackHandleBase(userId: string): string {
  const sanitized = sanitizeHandleCandidate(userId);
  if (sanitized) {
    return sanitized;
  }

  const cleaned = userId.replace(/[^a-zA-Z0-9]/g, "");
  const base = cleaned ? `user-${cleaned}` : `user-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
  return ensureHandleLength(base);
}

function ensureHandleLength(value: string): string {
  let result = value.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (!result) {
    result = "user";
  }

  while (result.length < HANDLE_MIN_LENGTH) {
    result += "u";
  }

  return result.slice(0, HANDLE_MAX_LENGTH);
}

function buildHandleVariant(base: string): string {
  const suffix = crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, 6);
  const trimmedBaseLength = Math.max(HANDLE_MIN_LENGTH, HANDLE_MAX_LENGTH - suffix.length - 1);
  const trimmedBase = ensureHandleLength(base).slice(0, trimmedBaseLength);
  const combined = `${trimmedBase}-${suffix}`;
  return combined.slice(0, HANDLE_MAX_LENGTH);
}

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
