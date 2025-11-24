import type { Env } from "../types";
import { UserQuotaResponseSchema, type UserQuotaResponse } from "@vibecodr/shared";
import { validateManifest, type Manifest } from "@vibecodr/shared/manifest";
import { requireCapsuleManifest } from "../capsule-manifest";
import {
  uploadCapsuleBundle,
  verifyCapsuleIntegrity,
  getCapsuleMetadata,
  deleteCapsuleBundle,
  type CapsuleFile,
  getCapsuleKey,
  listCapsuleFiles,
} from "../storage/r2";
import {
  getUserPlan,
  getUserStorageUsage,
  getUserStorageState,
  checkBundleSize,
  checkStorageQuota,
  incrementStorageUsage,
  PLAN_LIMITS,
  Plan,
} from "../storage/quotas";
import { requireAuth, type AuthenticatedUser } from "../auth";
import { incrementUserCounters, runCounterUpdate } from "./counters";
import { buildRuntimeManifest, type RuntimeArtifactType } from "../runtime/runtimeManifest";
import { compileHtmlArtifact } from "../runtime/compileHtmlArtifact";
import { recordBundleWarningMetrics } from "../runtime/bundleTelemetry";
import { hashCode, logSafetyVerdict, runSafetyCheck } from "../safety/safetyClient";
import { bundleInlineJs } from "./inlineBundle";
import { checkPublicRateLimit, getClientIp } from "../rateLimit";
import { json } from "../lib/responses";
import { resolveCapsuleAccess } from "../capsule-access";

const ERROR_REMIX_COUNTER_UPDATE_FAILED = "E-VIBECODR-0110";
const ERROR_REMIX_LINK_INSERT_FAILED = "E-VIBECODR-0111";

function writePublishAnalytics(
  env: Env,
  payload: {
    outcome: "success" | "error";
    plan?: Plan;
    totalSize?: number;
    fileCount?: number;
    warnings?: number;
    code?: string;
    capsuleId?: string;
    userId?: string;
  }
) {
  try {
    const analytics = env.vibecodr_analytics_engine;
    if (!analytics || typeof analytics.writeDataPoint !== "function") return;
    analytics.writeDataPoint({
      blobs: ["publish", payload.outcome, payload.plan ?? "", payload.code ?? "", payload.capsuleId ?? ""],
      doubles: [payload.totalSize ?? 0, payload.fileCount ?? 0, payload.warnings ?? 0],
      indexes: [payload.userId ?? ""],
    });
  } catch (err) {
    console.error("E-VIBECODR-0802 publish analytics failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function hashUint8(data: Uint8Array): Promise<string> {
  const buffer =
    data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? data.buffer
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(buffer as ArrayBuffer));
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

export const listUserCapsules: Handler = requireAuth(async (req, env, ctx, params, user) => {
  const limit = 50;
  const { results } = await env.DB.prepare(
    "SELECT id, manifest_json, created_at, quarantined, quarantine_reason, quarantined_at FROM capsules WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(user.userId, limit)
    .all();

  const capsules = (results || []).map((row: any) => {
    let title: string | null = null;
    try {
      const manifest = JSON.parse(row.manifest_json || "{}");
      if (manifest && typeof manifest.name === "string") {
        title = manifest.name;
      } else if (manifest && typeof manifest.title === "string") {
        title = manifest.title;
      }
    } catch {
      title = null;
    }
    return {
      id: String(row.id),
      title,
      createdAt: Number(row.created_at ?? 0),
      quarantined: Number(row.quarantined ?? 0) === 1,
      quarantineReason: (row as any).quarantine_reason ?? null,
      quarantinedAt: Number((row as any).quarantined_at ?? 0) || null,
    };
  });

  return json({ capsules });
});

type Handler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  user?: AuthenticatedUser
) => Promise<Response>;

// WHY: Terminology mapping for capsule/content hashes vs artifact IDs/digests lives in
// workers/api/docs/capsule-artifact-glossary.md to avoid misusing identifiers.
const RUNTIME_ARTIFACT_VERSION = "v0.1.0";
const RUNTIME_ARTIFACT_RUNNERS = new Set<Manifest["runner"]>(["client-static", "webcontainer"]);

function runtimeArtifactsEnabled(env: Env): boolean {
  const flag = env.RUNTIME_ARTIFACTS_ENABLED;
  if (typeof flag !== "string") {
    return true;
  }
  return flag.trim().toLowerCase() !== "false";
}

function isRuntimeArtifactRunner(manifest: Manifest): boolean {
  return RUNTIME_ARTIFACT_RUNNERS.has(manifest.runner as Manifest["runner"]);
}

export function resolveRuntimeArtifactType(manifest: Manifest): RuntimeArtifactType {
  if (manifest.runner === "client-static") {
    return manifest.entry.toLowerCase().endsWith(".html") || manifest.entry.toLowerCase().endsWith(".htm")
      ? "html"
      : "react-jsx";
  }
  return "react-jsx";
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
    if (!(manifestEntry instanceof File)) {
      return json({ error: "Missing manifest file" }, 400);
    }

    const manifestText = await manifestEntry.text();
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

    const pendingFiles: Array<{ key: string; file: File }> = [];
    formData.forEach((value, key) => {
      if (key === "manifest") return; // Already processed
      if (typeof value !== "string") {
        pendingFiles.push({ key, file: value });
      }
    });

    for (const { key, file } of pendingFiles) {
      const content = await file.arrayBuffer();
      const size = content.byteLength;
      totalSize += size;

      files.push({
        path: key,
        content,
        contentType: file.type || "application/octet-stream",
        size,
      });
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

    // SOTP Decision: Capture quarantine status for suspicious patterns
    let safetyResult: SafetyEnforcementResult = { shouldQuarantine: false };
    try {
      safetyResult = await enforceSafetyForFiles(env, manifest, files);
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
        // SOTP Decision: Pass quarantine info to persist function
        shouldQuarantine: safetyResult.shouldQuarantine,
        quarantineReason: safetyResult.quarantineReason,
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

        // Increment user's remixes count and ensure it runs even if the request returns early.
        await runCounterUpdate(ctx, () => incrementUserCounters(env, user.userId, { remixesDelta: 1 }), {
          code: ERROR_REMIX_COUNTER_UPDATE_FAILED,
          op: "publishCapsule increment remixes_count",
          details: {
            userId: user.userId,
            capsuleId: publishResult?.capsule.id,
            parentCapsuleId,
          },
        });
      }
    } catch (err) {
      console.error(`${ERROR_REMIX_LINK_INSERT_FAILED} publishCapsule remix insert failed`, {
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
  // SOTP Decision: Quarantine capsules with suspicious patterns
  shouldQuarantine?: boolean;
  quarantineReason?: string;
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

// SOTP Decision: Return quarantine status instead of just throwing
export type SafetyEnforcementResult = {
  shouldQuarantine: boolean;
  quarantineReason?: string;
  quarantineTags?: string[];
};

export async function enforceSafetyForFiles(
  env: Env,
  manifest: Manifest,
  files: CapsuleFile[]
): Promise<SafetyEnforcementResult> {
  const decoder = new TextDecoder();
  let shouldQuarantine = false;
  let quarantineReason: string | undefined;
  let quarantineTags: string[] | undefined;

  for (const file of files) {
    if (file.path === "manifest.json") continue;
    const language =
      file.path.toLowerCase().endsWith(".html") || file.path.toLowerCase().endsWith(".htm")
        ? "html"
        : "javascript";
    const content =
      typeof file.content === "string"
        ? file.content
        : decoder.decode(file.content as ArrayBuffer);

    const codeHash = await hashCode(content);
    const verdict = await runSafetyCheck(env, {
      code: content,
      language,
      environment: "capsule",
      codeHash,
    });

    logSafetyVerdict(env, {
      entryPath: file.path,
      codeHash,
      verdict,
    });

    // SOTP Decision: Hard block for severe violations, quarantine for suspicious patterns
    if (verdict.action === "block") {
      throw new PublishCapsuleError(403, {
        error: "Unsafe code detected",
        code: "E-VIBECODR-SECURITY-BLOCK",
        reasons: verdict.reasons,
        risk: verdict.risk_level,
        tags: verdict.tags,
        path: file.path,
      });
    }

    // SOTP Decision: Quarantine preserves evidence and lowers false-positive fallout
    if (verdict.action === "quarantine") {
      shouldQuarantine = true;
      quarantineReason = verdict.reasons.join("; ");
      quarantineTags = verdict.tags;
      console.warn("E-VIBECODR-0507 capsule flagged for quarantine", {
        path: file.path,
        codeHash,
        reasons: verdict.reasons,
        tags: verdict.tags,
      });
    }
  }

  return { shouldQuarantine, quarantineReason, quarantineTags };
}

type RuntimeArtifactSummary = {
  id: string;
  runtimeVersion?: string | null;
  bundleDigest?: string | null;
  bundleSizeBytes?: number | null;
  queued?: boolean;
  bundleKey?: string;
};

type UploadResultSnapshot = { contentHash: string; totalSize: number; fileCount: number };

async function createCapsuleBackedArtifactRecord(params: {
  env: Env;
  manifest: Manifest;
  files: CapsuleFile[];
  uploadResult: UploadResultSnapshot;
  capsuleId: string;
  userId: string;
  artifactId: string;
  artifactType: RuntimeArtifactType;
}): Promise<RuntimeArtifactSummary> {
  const { env, manifest, files, uploadResult, capsuleId, userId, artifactId, artifactType } = params;
  const runtimeVersion = RUNTIME_ARTIFACT_VERSION;
  const bundleKey = getCapsuleKey(uploadResult.contentHash, manifest.entry);
  const entryFile = files.find((f) => f.path === manifest.entry);

  let bundleDigest = uploadResult.contentHash;
  let bundleSizeBytes = uploadResult.totalSize;

  if (entryFile) {
    const entryBytes =
      typeof entryFile.content === "string"
        ? new TextEncoder().encode(entryFile.content)
        : new Uint8Array(entryFile.content as ArrayBuffer);
    bundleDigest = await hashUint8(entryBytes);
    bundleSizeBytes = entryFile.size;
  }

  await env.DB.prepare(
    "INSERT INTO artifacts (id, owner_id, capsule_id, type, runtime_version, bundle_digest) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(artifactId, userId, capsuleId, artifactType, runtimeVersion, bundleDigest)
    .run();

  const runtimeManifest = buildRuntimeManifest({
    artifactId,
    type: artifactType,
    bundleKey,
    bundleSizeBytes,
    bundleDigest,
    runtimeVersion,
  });
  const runtimeManifestJson = JSON.stringify(runtimeManifest);
  const runtimeManifestSize = new TextEncoder().encode(runtimeManifestJson).byteLength;
  const artifactManifestId = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO artifact_manifests (id, artifact_id, version, manifest_json, size_bytes, runtime_version) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(artifactManifestId, artifactId, 1, runtimeManifestJson, runtimeManifestSize, runtimeVersion)
    .run();

  if (env.RUNTIME_MANIFEST_KV) {
    const kvKey = `artifacts/${artifactId}/v1/runtime-manifest.json`;
    try {
      await env.RUNTIME_MANIFEST_KV.put(kvKey, runtimeManifestJson);
    } catch (kvErr) {
      console.error("E-VIBECODR-0504 runtime manifest KV write failed (capsule-backed artifact)", {
        capsuleId,
        artifactId,
        userId,
        error: kvErr instanceof Error ? kvErr.message : String(kvErr),
      });
    }
  }

  return {
    id: artifactId,
    runtimeVersion,
    bundleDigest,
    bundleSizeBytes,
    bundleKey,
    queued: false,
  };
}

export async function createRuntimeArtifactForCapsule(params: {
  env: Env;
  manifest: Manifest;
  files: CapsuleFile[];
  uploadResult: UploadResultSnapshot;
  capsuleId: string;
  userId: string;
  artifactId?: string;
  artifactType?: RuntimeArtifactType;
}): Promise<RuntimeArtifactSummary> {
  const { env, manifest, files, uploadResult, capsuleId, userId } = params;
  const artifactId = params.artifactId ?? crypto.randomUUID();
  const artifactType = params.artifactType ?? resolveRuntimeArtifactType(manifest);
  const runtimeVersion = RUNTIME_ARTIFACT_VERSION;

  let bundleR2Key = `capsules/${uploadResult.contentHash}/${manifest.entry}`;
  let bundleDigest = uploadResult.contentHash;
  let bundleSizeBytes = uploadResult.totalSize;

  if (manifest.runner === "webcontainer") {
    try {
      const sourceFiles = new Map<string, Uint8Array>();
      for (const file of files) {
        if (file.path === "manifest.json") continue;
        const content =
          typeof file.content === "string"
            ? new TextEncoder().encode(file.content)
            : new Uint8Array(file.content as ArrayBuffer);
        sourceFiles.set(file.path, content);
      }

      const bundled = await bundleInlineJs(sourceFiles, manifest.entry);
      bundleR2Key = `artifacts/${artifactId}/bundle.js`;
      bundleSizeBytes = bundled.content.byteLength;
      bundleDigest = await hashUint8(bundled.content);

      await env.R2.put(bundleR2Key, bundled.content, {
        httpMetadata: { contentType: "application/javascript" },
      });
    } catch (err) {
      console.error("E-VIBECODR-0501 runtime artifact bundle failed", {
        capsuleId,
        artifactId,
        runner: manifest.runner,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new PublishCapsuleError(500, {
        error: "Failed to build runtime artifact",
        code: "E-VIBECODR-0501",
      });
    }
  } else {
    const entryFile = files.find((f) => f.path === manifest.entry);
    if (entryFile) {
      const entryBytes =
        typeof entryFile.content === "string"
          ? new TextEncoder().encode(entryFile.content)
          : new Uint8Array(entryFile.content as ArrayBuffer);
      bundleDigest = await hashUint8(entryBytes);
      bundleSizeBytes = entryFile.size;
    }
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
    .bind(artifactId, userId, capsuleId, artifactType, runtimeVersion, runtimeManifest.bundle.digest)
    .run();

  const artifactManifestId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO artifact_manifests (id, artifact_id, version, manifest_json, size_bytes, runtime_version) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(artifactManifestId, artifactId, 1, runtimeManifestJson, runtimeManifestSize, runtimeVersion)
    .run();

  if (env.RUNTIME_MANIFEST_KV) {
    const kvKey = `artifacts/${artifactId}/v1/runtime-manifest.json`;
    try {
      await env.RUNTIME_MANIFEST_KV.put(kvKey, runtimeManifestJson);
    } catch (kvErr) {
      console.error("E-VIBECODR-0502 runtime manifest KV write failed", {
        capsuleId,
        artifactId,
        userId,
        error: kvErr instanceof Error ? kvErr.message : String(kvErr),
      });
    }
  }

  return {
    id: artifactId,
    runtimeVersion,
    bundleDigest: runtimeManifest.bundle.digest,
    bundleSizeBytes,
    bundleKey: runtimeManifest.bundle.r2Key,
    queued: false,
  };
}

export async function ensureUserStorageAccount(env: Env, user: AuthenticatedUser, plan: Plan): Promise<void> {
  const existing = await env.DB.prepare("SELECT storage_version FROM users WHERE id = ? LIMIT 1")
    .bind(user.userId)
    .first<{ storage_version?: number }>();

  if (existing) {
    return;
  }

  const outcome = await bootstrapUserStorageAccount({
    env,
    user,
    plan,
    storageDelta: 0,
    nextVersion: 1,
  });

  if (outcome === "retry") {
    return;
  }
}

export async function persistCapsuleBundle(input: PersistCapsuleInput): Promise<PersistCapsuleResult> {
  const { env, user, manifest, manifestText, files, totalSize, warnings, shouldQuarantine, quarantineReason } = input;
  recordBundleWarningMetrics(env, warnings, "capsulePublish");

  const initialStorageState = await getUserStorageState(user.userId, env);
  const plan = initialStorageState.plan;

  const sizeCheck = checkBundleSize(plan, totalSize);
  if (!sizeCheck.allowed) {
    throw new PublishCapsuleError(400, {
      error: "Bundle size limit exceeded",
      reason: sizeCheck.reason,
      bundleSize: totalSize,
      limit: sizeCheck.limits?.maxBundleSize,
    });
  }

  const storageCheck = checkStorageQuota(plan, initialStorageState.storageUsageBytes, totalSize);
  if (!storageCheck.allowed) {
    throw new PublishCapsuleError(400, {
      error: "Storage quota exceeded",
      reason: storageCheck.reason,
      currentUsage: initialStorageState.storageUsageBytes,
      additionalSize: totalSize,
      limit: storageCheck.limits?.maxStorage,
    });
  }

  await ensureUserStorageAccount(env, user, plan);

  const uploadResult = await uploadCapsuleBundle(env.R2, files, manifest, user.userId);
  const integrityOk = await verifyCapsuleIntegrity(env.R2, uploadResult.contentHash, uploadResult.contentHash);
  if (!integrityOk) {
    throw new PublishCapsuleError(500, { error: "Integrity verification failed" });
  }

  const capsuleId = crypto.randomUUID();
  // SOTP Decision: Set quarantined=1 for suspicious patterns to hide from feeds
  const quarantinedValue = shouldQuarantine ? 1 : 0;
  const quarantinedAt = shouldQuarantine ? Math.floor(Date.now() / 1000) : null;
  const quarantineReasonValue =
    shouldQuarantine && typeof quarantineReason === "string" && quarantineReason.trim().length > 0
      ? quarantineReason
      : shouldQuarantine
        ? "auto_quarantine"
        : null;
  await env.DB.prepare(
    "INSERT INTO capsules (id, owner_id, manifest_json, hash, created_at, quarantined, quarantine_reason, quarantined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      capsuleId,
      user.userId,
      manifestText,
      uploadResult.contentHash,
      Math.floor(Date.now() / 1000),
      quarantinedValue,
      quarantineReasonValue,
      quarantinedAt
    )
    .run();

  // Log quarantine event for audit trail
  if (shouldQuarantine) {
    console.warn("E-VIBECODR-0508 capsule auto-quarantined on publish", {
      capsuleId,
      userId: user.userId,
      reason: quarantineReason,
    });
  }

  for (const file of files) {
    await env.DB.prepare("INSERT INTO assets (id, capsule_id, key, size) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), capsuleId, file.path, file.size)
      .run();
  }

  const cleanupPersistedCapsule = async () => {
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

  try {
    const latestState = await getUserStorageState(user.userId, env);
    const latestStorageCheck = checkStorageQuota(latestState.plan, latestState.storageUsageBytes, totalSize);
    if (!latestStorageCheck.allowed) {
      await cleanupPersistedCapsule();
      throw new PublishCapsuleError(400, {
        error: "Storage quota exceeded",
        reason: latestStorageCheck.reason,
        currentUsage: latestState.storageUsageBytes,
        additionalSize: totalSize,
        limit: latestStorageCheck.limits?.maxStorage,
      });
    }

    await incrementStorageUsage(user.userId, env, totalSize, { expectedVersion: latestState.storageVersion });
  } catch (err) {
    await cleanupPersistedCapsule();
    if (err instanceof PublishCapsuleError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("E-VIBECODR-0405")) {
      throw new PublishCapsuleError(400, {
        error: "Storage quota exceeded",
        code: "E-VIBECODR-0405",
        details: message,
      });
    }
    if (message.includes("E-VIBECODR-0406")) {
      throw new PublishCapsuleError(409, {
        error: "Concurrent upload detected. Please retry.",
        code: "E-VIBECODR-CONCURRENT-UPLOAD",
      });
    }
    throw new PublishCapsuleError(500, {
      error: "Failed to record storage usage",
      code: "E-VIBECODR-0406",
      details: message,
    });
  }

  writePublishAnalytics(env, {
    outcome: "success",
    plan,
    totalSize,
    fileCount: uploadResult.fileCount,
    warnings: warnings?.length ?? 0,
    capsuleId,
    userId: user.userId,
  });

  let artifactSummary:
    | {
        id: string;
        runtimeVersion?: string | null;
        bundleDigest?: string | null;
      bundleSizeBytes?: number | null;
      queued?: boolean;
    }
    | null = null;

  const artifactId = crypto.randomUUID();
  const artifactType = resolveRuntimeArtifactType(manifest);
  const runtimeEnabled = runtimeArtifactsEnabled(env) && isRuntimeArtifactRunner(manifest);

  if (runtimeEnabled) {
    try {
      artifactSummary = await createRuntimeArtifactForCapsule({
        env,
        manifest,
        files,
        uploadResult,
        capsuleId,
        userId: user.userId,
        artifactId,
        artifactType,
      });
    } catch (err) {
      if (err instanceof PublishCapsuleError) {
        throw err;
      }
      console.error("E-VIBECODR-0503 runtime artifact create failed", {
        capsuleId,
        userId: user.userId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new PublishCapsuleError(500, {
        error: "Failed to create runtime artifact",
        code: "E-VIBECODR-0503",
      });
    }
  } else {
    try {
      artifactSummary = await createCapsuleBackedArtifactRecord({
        env,
        manifest,
        files,
        uploadResult,
        capsuleId,
        userId: user.userId,
        artifactId,
        artifactType,
      });
    } catch (err) {
      console.error("E-VIBECODR-0506 capsule-backed artifact create failed", {
        capsuleId,
        userId: user.userId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new PublishCapsuleError(500, {
        error: "Failed to record artifact",
        code: "E-VIBECODR-0506",
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
  const claims = user.claims;
  const publicMetadataRaw =
    (claims as { public_metadata?: unknown }).public_metadata ??
    (claims as { publicMetadata?: unknown }).publicMetadata;
  const publicMetadata =
    publicMetadataRaw && typeof publicMetadataRaw === "object" ? (publicMetadataRaw as Record<string, unknown>) : null;
  const claimHandles = [
    typeof claims.username === "string" ? claims.username : null,
    typeof claims.preferred_username === "string" ? claims.preferred_username : null,
    typeof claims.handle === "string" ? claims.handle : null,
    publicMetadata && typeof publicMetadata.handle === "string" ? publicMetadata.handle : null,
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

  const clientIp = getClientIp(req);
  const rate = await checkPublicRateLimit(env, `capsule:${clientIp ?? "unknown"}`, 60);
  if (!rate.allowed) {
    const retryAfter = rate.resetAt ? Math.ceil((rate.resetAt - Date.now()) / 1000) : 60;
    return json(
      { error: "Rate limit exceeded", code: "E-VIBECODR-0311", scope: "capsule-read" },
      429,
      {
        headers: {
          "Retry-After": retryAfter.toString(),
          "X-RateLimit-Limit": "60",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": rate.resetAt ? Math.floor(rate.resetAt / 1000).toString() : "",
        },
      }
    );
  }

  try {
    const access = await resolveCapsuleAccess(req, env, capsuleId);
    if (access instanceof Response) {
      return access;
    }

    const { capsule, moderation } = access;
    const contentHash = String((capsule as any).hash);

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
      createdAt: typeof capsule.created_at === "number" ? capsule.created_at : Number(capsule.created_at ?? 0),
      metadata,
      verified: true,
      moderation,
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

  const clientIp = getClientIp(req);
  const rate = await checkPublicRateLimit(env, `capsule-verify:${clientIp ?? "unknown"}`, 60);
  if (!rate.allowed) {
    const retryAfter = rate.resetAt ? Math.ceil((rate.resetAt - Date.now()) / 1000) : 60;
    return json(
      { error: "Rate limit exceeded", code: "E-VIBECODR-0311", scope: "capsule-verify" },
      429,
      {
        headers: {
          "Retry-After": retryAfter.toString(),
          "X-RateLimit-Limit": "60",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": rate.resetAt ? Math.floor(rate.resetAt / 1000).toString() : "",
        },
      }
    );
  }

  try {
    const access = await resolveCapsuleAccess(req, env, capsuleId);
    if (access instanceof Response) {
      return access;
    }

    const { capsule, moderation } = access;
    const contentHash = String((capsule as any).hash);
    const verified = await verifyCapsuleIntegrity(env.R2, contentHash, contentHash);

    return json({
      capsuleId,
      contentHash,
      verified,
      timestamp: Date.now(),
      moderation,
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

    const planLimits = PLAN_LIMITS[plan];
    const payload: UserQuotaResponse = {
      plan,
      usage: {
        storage: storageUsage,
        runs: runsThisMonth,
        bundleSize: 0,
        liveMinutes: 0,
      },
      limits: planLimits,
      percentUsed: {
        storage: planLimits.maxStorage > 0 ? (storageUsage / planLimits.maxStorage) * 100 : 0,
        runs: planLimits.maxRuns > 0 ? (runsThisMonth / planLimits.maxRuns) * 100 : 0,
      },
    };

    return json(UserQuotaResponseSchema.parse(payload));
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
