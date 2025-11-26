/**
 * Import handlers for GitHub and ZIP uploads
 * Implements the import pipeline: Download → Analyze → Build → Upload
 * Based on research-github-import-storage.md
 */

import JSZip from "jszip";
import { validateManifest, type Manifest } from "@vibecodr/shared/manifest";
import type { Env, Handler } from "../types";
import { requireAuth, type AuthenticatedUser } from "../auth";
import { collectEntryCandidates } from "../capsule-manifest";
import {
  sanitizeHtmlEntryIfNeeded,
  type PublishWarning,
  PublishCapsuleError,
  enforceSafetyForFiles,
  persistCapsuleBundle,
  type PersistCapsuleResult,
} from "./capsules";
import {
  checkBundleSize,
  getUserRunQuotaState,
  getUserStorageState,
  type Plan,
} from "../storage/quotas";
import type { CapsuleFile } from "../storage/r2";
import { bundleWithEsbuild } from "../runtime/esbuildBundler";
import { json } from "../lib/responses";

interface AnalysisResult {
  entryPoint: string;
  files: Map<string, Uint8Array>;
  totalSize: number;
  detectedLicense?: string;
  hasServerCode: boolean;
  warnings: string[];
  entryCandidates: string[];
  sourceName?: string;
  sourceManifest?: Manifest | null;
}

type ImportResponse = {
  success: true;
  capsuleId: string;
  manifest: Manifest;
  draftManifest: Manifest;
  filesSummary: {
    contentHash: string;
    totalSize: number;
    fileCount: number;
    entryPoint: string;
    entryCandidates: string[];
  };
  warnings?: PublishWarning[];
  artifact?: PersistCapsuleResult["artifact"];
  /** Source name (repo name or zip filename) for DraftCapsule */
  sourceName?: string;
};

type ImportOutcome =
  | { ok: true; status: number; body: ImportResponse }
  | { ok: false; status: number; body: Record<string, unknown> };

type ProgressEmitter = (step: string, progress?: number, detail?: Record<string, unknown>) => void;

/**
 * POST /import/github
 * Import from GitHub repository via archive download
 */
export const importGithub: Handler = requireAuth(async (req, env, ctx, params, user) => {
  try {
    const body = await req.json();
    const { url, branch = "main" } = body as { url: string; branch?: string };

    if (!url || !url.includes("github.com")) {
      return json({ success: false, error: "Invalid GitHub URL" }, 400);
    }

    const runQuota = await getUserRunQuotaState(user.userId, env);
    if (!runQuota.result.allowed) {
      writeImportAnalytics(env, {
        outcome: "error",
        code: "run_quota_exceeded",
        plan: runQuota.plan,
        userId: user.userId,
      });
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

    // Parse GitHub URL
    const repoMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      return json({ success: false, error: "Could not parse repository URL" }, 400);
    }

    const [, owner, repo] = repoMatch;
    const repoName = repo.replace(/\.git$/, "");

    // Download archive (tarball or zipball)
    const archiveUrl = `https://github.com/${owner}/${repoName}/archive/refs/heads/${branch}.zip`;

    const archiveResponse = await fetch(archiveUrl);
    if (!archiveResponse.ok) {
      return json(
        {
          success: false,
          error: `Failed to download repository: ${archiveResponse.statusText}`,
        },
        archiveResponse.status
      );
    }

    const archiveBuffer = await archiveResponse.arrayBuffer();

    // Extract and analyze
    const analysis = await analyzeArchive(new Uint8Array(archiveBuffer), {
      stripPrefix: `${repoName}-${branch}/`,
      sourceName: repoName,
    });

    if (analysis.hasServerCode) {
      analysis.warnings.push("Server-side code detected. Only client-side code will run.");
    }

    return await respondWithImportProgress(req, (emit) => processImport(env, user, analysis, emit));
  } catch (error) {
    console.error("GitHub import error:", error);
    return json(
      {
        error: error instanceof Error ? error.message : "Import failed",
      },
      500
    );
  }
});

/**
 * POST /import/zip
 * Import from uploaded ZIP file
 */
export const importZip: Handler = requireAuth(async (req, env, ctx, params, user) => {
  try {
    // Get ZIP file from multipart form data
    const contentType = req.headers.get("content-type") || "";

    let zipBuffer: ArrayBuffer;
    let sourceName: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const fileEntry = formData.get("file");

      if (!fileEntry || typeof fileEntry === "string") {
        return json({ success: false, error: "No file uploaded" }, 400);
      }

      const file = fileEntry as File;
      sourceName = file.name.replace(/\.zip$/i, "") || undefined;

      if (!file.name.endsWith(".zip")) {
        return json({ success: false, error: "File must be a ZIP archive" }, 400);
      }

      zipBuffer = await file.arrayBuffer();
    } else if (contentType.includes("application/zip")) {
      // Direct binary upload
      zipBuffer = await req.arrayBuffer();
    } else {
      return json(
        {
          success: false,
          error: "Content-Type must be multipart/form-data or application/zip",
        },
        400
      );
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

    if (zipBuffer.byteLength > 250 * 1024 * 1024) {
      return json(
        {
          error: "ZIP file exceeds 250 MB limit",
        },
        400
      );
    }

    // Analyze ZIP contents
    const analysis = await analyzeArchive(new Uint8Array(zipBuffer), { sourceName });
    if (analysis.hasServerCode) {
      analysis.warnings.push("Server-side code detected. Only client-side code will run.");
    }

    return await respondWithImportProgress(req, (emit) => processImport(env, user, analysis, emit));
  } catch (error) {
    console.error("ZIP import error:", error);
    return json(
      {
        error: error instanceof Error ? error.message : "Import failed",
      },
      500
    );
  }
});

/**
 * Analyze archive contents and detect entry point
 */
async function analyzeArchive(
  buffer: Uint8Array,
  options?: { stripPrefix?: string; sourceName?: string }
): Promise<AnalysisResult> {
  const zip = await JSZip.loadAsync(buffer);
  const files = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  let totalSize = 0;
  let detectedLicense: string | undefined;
  let hasServerCode = false;
  let sourceManifest: Manifest | null = null;

  // Extract all files
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;

    // Strip prefix if provided (e.g., repo-name-branch/)
    let cleanPath = path;
    if (options?.stripPrefix && path.startsWith(options.stripPrefix)) {
      cleanPath = path.slice(options.stripPrefix.length);
    }

    // Skip hidden files and common build artifacts
    if (
      cleanPath.startsWith(".") ||
      cleanPath.includes("node_modules/") ||
      cleanPath.includes("__pycache__/") ||
      cleanPath.includes(".git/")
    ) {
      continue;
    }

    const content = await file.async("uint8array");
    files.set(cleanPath, content);
    totalSize += content.byteLength;
    if (cleanPath.toLowerCase() === "manifest.json") {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(content));
        const validation = validateManifest(parsed);
        if (validation.valid) {
          sourceManifest = parsed as Manifest;
        } else if (validation.errors && validation.errors.length > 0) {
          warnings.push(`Manifest in archive ignored: ${validation.errors[0].message}`);
        }
      } catch {
        warnings.push("Manifest in archive ignored: JSON parse failed");
      }
    }

    // Detect license files
    if (cleanPath.toLowerCase().includes("license")) {
      const text = new TextDecoder().decode(content);
      detectedLicense = detectSPDXLicense(text);
    }

    // Check for server-side code indicators
    if (
      cleanPath.endsWith(".server.js") ||
      cleanPath.endsWith(".server.ts") ||
      cleanPath.includes("/api/") ||
      cleanPath.includes("server/")
    ) {
      hasServerCode = true;
    }
  }

  const entryCandidates = collectEntryCandidates(files.keys());
  let entryPoint = sourceManifest?.entry && files.has(sourceManifest.entry) ? sourceManifest.entry : detectEntryPoint(files);

  if (!entryPoint) {
    throw new Error("Could not detect entry point (index.html, main.js, etc.)");
  }
  if (sourceManifest?.entry && sourceManifest.entry !== entryPoint) {
    warnings.push(`Manifest entry not found in archive: ${sourceManifest.entry}`);
  }

  if (!detectedLicense) {
    warnings.push("No license file detected. Consider adding an SPDX license.");
  }

  return {
    entryPoint,
    files,
    totalSize,
    detectedLicense,
    hasServerCode,
    warnings,
    entryCandidates: entryCandidates.includes(entryPoint)
      ? entryCandidates
      : [entryPoint, ...entryCandidates],
    sourceName: options?.sourceName,
    sourceManifest,
  };
}

/**
 * Detect SPDX license identifier from license text
 */
function detectSPDXLicense(text: string): string | undefined {
  const commonLicenses = [
    { id: "MIT", keywords: ["MIT License", "Permission is hereby granted"] },
    { id: "Apache-2.0", keywords: ["Apache License", "Version 2.0"] },
    { id: "GPL-3.0", keywords: ["GNU General Public License", "version 3"] },
    { id: "BSD-3-Clause", keywords: ["BSD 3-Clause"] },
    { id: "ISC", keywords: ["ISC License"] },
  ];

  for (const license of commonLicenses) {
    if (license.keywords.some((keyword) => text.includes(keyword))) {
      return license.id;
    }
  }

  return undefined;
}

/**
 * Generate manifest from bundled files and analysis
 */
async function generateManifest(
  files: Map<string, Uint8Array>,
  analysis: AnalysisResult
): Promise<Manifest> {
  const baseManifest = analysis.sourceManifest ?? undefined;
  const defaultTitle =
    (baseManifest?.title && baseManifest.title.trim()) ||
    (analysis.sourceName && analysis.sourceName.trim()) ||
    "Imported Capsule";
  const defaultDescription =
    (baseManifest?.description && baseManifest.description.trim()) ||
    (analysis.sourceName ? `Imported from ${analysis.sourceName}` : "Imported from archive");
  // Detect parameters from entry file if it's HTML
  const params: Manifest["params"] = baseManifest?.params ?? [];

  if (analysis.entryPoint.endsWith(".html")) {
    const html = new TextDecoder().decode(files.get(analysis.entryPoint));
    // Simple parameter detection from HTML comments or data attributes
    // In production, this would be more sophisticated
    void html;
  }

  return {
    ...baseManifest,
    version: "1.0",
    runner: baseManifest?.runner ?? "client-static",
    entry: analysis.entryPoint,
    title: defaultTitle,
    description: defaultDescription,
    params,
    capabilities: baseManifest?.capabilities ?? {
      storage: false,
      workers: false,
    },
    license: baseManifest?.license ?? analysis.detectedLicense,
  };
}

function convertBundledMapToCapsuleFiles(map: Map<string, Uint8Array>): CapsuleFile[] {
  const files: CapsuleFile[] = [];
  for (const [path, content] of map.entries()) {
    const buffer = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength
    ) as ArrayBuffer;
    files.push({
      path,
      content: buffer,
      contentType: getContentType(path),
      size: buffer.byteLength,
    });
  }
  return files;
}

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    js: "application/javascript",
    mjs: "application/javascript",
    ts: "application/typescript",
    tsx: "application/typescript",
    jsx: "application/javascript",
    css: "text/css",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    wasm: "application/wasm",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    ico: "image/x-icon",
  };
  return types[ext || ""] || "application/octet-stream";
}

function writeImportAnalytics(
  env: Env,
  payload: {
    outcome: "success" | "error";
    plan?: Plan;
    totalSize?: number;
    fileCount?: number;
    warnings?: number;
    code?: string;
    userId?: string;
  }
) {
  try {
    const analytics = env.vibecodr_analytics_engine;
    if (!analytics || typeof analytics.writeDataPoint !== "function") return;
    analytics.writeDataPoint({
      blobs: ["import", payload.outcome, payload.plan ?? "", payload.code ?? ""],
      doubles: [payload.totalSize ?? 0, payload.fileCount ?? 0, payload.warnings ?? 0],
      indexes: [payload.userId ?? ""],
    });
  } catch (err) {
    console.error("E-VIBECODR-0801 import analytics failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function toPublishWarnings(
  analysisWarnings: string[],
  bundlerWarnings: string[],
  validationWarnings?: { path: string; message: string }[]
): PublishWarning[] | undefined {
  const mappedAnalysis = analysisWarnings.map<PublishWarning>((message, idx) => ({
    path: `analysis.${idx}`,
    message,
  }));
  const mappedBundler = bundlerWarnings.map<PublishWarning>((message, idx) => ({
    path: `bundle.${idx}`,
    message,
  }));
  const mappedValidation =
    validationWarnings?.map<PublishWarning>((warning) => ({
      path: warning.path,
      message: warning.message,
    })) ?? [];

  const combined = [...mappedAnalysis, ...mappedBundler, ...mappedValidation];
  return combined.length > 0 ? combined : undefined;
}

function detectEntryPoint(files: Map<string, Uint8Array>): string | null {
  const candidates = [
    "index.html",
    "main.html",
    "index.htm",
    "main.tsx",
    "index.tsx",
    "main.ts",
    "index.ts",
    "main.jsx",
    "index.jsx",
    "main.js",
    "index.js",
    "app.tsx",
    "app.jsx",
    "app.js",
    "bundle.js",
    "dist/index.html",
    "dist/main.html",
    "build/index.html",
    "public/index.html",
    "src/main.tsx",
    "src/index.tsx",
  ];

  for (const candidate of candidates) {
    if (files.has(candidate)) {
      return candidate;
    }
  }

  for (const path of files.keys()) {
    if (path.endsWith(".html") || path.endsWith(".htm")) {
      return path;
    }
  }

  return null;
}

async function buildManifestWithMetadata(
  manifest: Manifest,
  files: CapsuleFile[],
  analysis: AnalysisResult
): Promise<{ manifest: Manifest; manifestText: string; manifestFile: CapsuleFile }> {
  const assetSummaries =
    files
      .filter((f) => f.path !== "manifest.json")
      .map((f) => ({
        path: f.path,
        size: f.size,
      })) ?? [];
  const bundleSize = files.reduce((acc, f) => (f.path === "manifest.json" ? acc : acc + f.size), 0);
  const manifestWithMeta: Manifest = {
    ...manifest,
    bundleSize,
    assets: assetSummaries,
    license: manifest.license ?? analysis.detectedLicense,
  };

  const manifestText = JSON.stringify(manifestWithMeta, null, 2);
  const bytes = new TextEncoder().encode(manifestText);
  const manifestFile: CapsuleFile = {
    path: "manifest.json",
    content: bytes.buffer as ArrayBuffer,
    contentType: "application/json",
    size: bytes.byteLength,
  };

  return { manifest: manifestWithMeta, manifestText, manifestFile };
}

async function processImport(
  env: Env,
  user: AuthenticatedUser,
  analysis: AnalysisResult,
  onProgress?: ProgressEmitter
): Promise<ImportOutcome> {
  onProgress?.("analyzing", 0.1, { totalSize: analysis.totalSize });
  const storageState = await getUserStorageState(user.userId, env);
  const plan = storageState.plan;

    const preBundleSizeCheck = checkBundleSize(plan, analysis.totalSize);
    if (!preBundleSizeCheck.allowed) {
      writeImportAnalytics(env, {
        outcome: "error",
        code: "bundle_limit",
        plan,
        totalSize: analysis.totalSize,
        userId: user.userId,
      });
      return {
        ok: false,
        status: 400,
        body: {
          error: "Bundle size limit exceeded",
        reason: preBundleSizeCheck.reason,
        plan,
        limits: preBundleSizeCheck.limits,
        usage: { bundleSize: analysis.totalSize },
      },
    };
  }

  // Bundle with esbuild (same helper used for artifacts)
  onProgress?.("bundling", 0.25);
  const {
    files: bundledFiles,
    entryPoint: bundledEntryPoint,
    warnings: bundlerWarnings,
  } = await bundleWithEsbuild(analysis.files, analysis.entryPoint);

  const bundledEntryCandidates = collectEntryCandidates(bundledFiles.keys());
  const analysisForManifest: AnalysisResult = {
    ...analysis,
    entryPoint: bundledEntryPoint,
    entryCandidates: bundledEntryCandidates.includes(bundledEntryPoint)
      ? bundledEntryCandidates
      : [bundledEntryPoint, ...bundledEntryCandidates],
  };

  const manifestDraft = await generateManifest(bundledFiles, analysisForManifest);
  const validation = validateManifest(manifestDraft);
  if (!validation.valid) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Invalid manifest",
        errors: validation.errors,
        warnings: validation.warnings,
      },
    };
  }

  // Convert bundled files for storage
  const bundledCapsuleFiles = convertBundledMapToCapsuleFiles(bundledFiles);

  // Safety enforcement - capture quarantine result for persistCapsuleBundle
  let safetyResult: { shouldQuarantine: boolean; quarantineReason?: string } = { shouldQuarantine: false };
  try {
    onProgress?.("safety", 0.45);
    const enforcement = await enforceSafetyForFiles(env, manifestDraft, bundledCapsuleFiles);
    if (enforcement) {
      safetyResult = enforcement;
    }
  } catch (err) {
    if (err instanceof PublishCapsuleError) {
      return { ok: false, status: err.status, body: err.body };
    }
    throw err;
  }

  // HTML sanitization (also done in persistCapsuleBundle, but needed here for manifest metadata)
  const sanitized = sanitizeHtmlEntryIfNeeded(bundledCapsuleFiles, manifestDraft);
  let filesForUpload = sanitized.files;
  let totalSize = sanitized.totalSize;

  onProgress?.("manifest", 0.6);
  const { manifest, manifestText, manifestFile } = await buildManifestWithMetadata(
    manifestDraft,
    filesForUpload,
    analysisForManifest
  );

  filesForUpload = [...filesForUpload, manifestFile];
  totalSize += manifestFile.size;

  const validationWithMeta = validateManifest(manifest);
  if (!validationWithMeta.valid) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Invalid manifest",
        errors: validationWithMeta.errors,
        warnings: validationWithMeta.warnings,
      },
    };
  }

  const warnings = toPublishWarnings(
    analysisForManifest.warnings,
    bundlerWarnings,
    validationWithMeta.warnings ?? validation.warnings
  );

  // Use canonical persistCapsuleBundle - handles quotas, storage, R2, D1, and runtime artifacts
  onProgress?.("persisting", 0.8);
  let persistResult: PersistCapsuleResult;
  try {
    persistResult = await persistCapsuleBundle({
      env,
      user,
      manifest,
      manifestText,
      files: filesForUpload,
      totalSize,
      warnings,
      shouldQuarantine: safetyResult.shouldQuarantine,
      quarantineReason: safetyResult.quarantineReason,
    });
  } catch (err) {
    if (err instanceof PublishCapsuleError) {
      writeImportAnalytics(env, {
        outcome: "error",
        code: err.body?.code as string ?? "persist_failed",
        plan,
        totalSize,
        userId: user.userId,
      });
      return { ok: false, status: err.status, body: err.body };
    }
    throw err;
  }

  writeImportAnalytics(env, {
    outcome: "success",
    plan,
    totalSize,
    fileCount: persistResult.capsule.fileCount,
    warnings: warnings?.length ?? 0,
    userId: user.userId,
  });

  // Transform to ImportResponse shape (aligns with DraftCapsule contract)
  const response: ImportResponse = {
    success: true,
    capsuleId: persistResult.capsule.id,
    manifest,
    draftManifest: manifest,
    filesSummary: {
      contentHash: persistResult.capsule.contentHash,
      totalSize: persistResult.capsule.totalSize,
      fileCount: persistResult.capsule.fileCount,
      entryPoint: manifest.entry,
      entryCandidates: analysisForManifest.entryCandidates,
    },
    warnings: persistResult.warnings,
    artifact: persistResult.artifact,
    sourceName: analysis.sourceName,
  };

  onProgress?.("done", 1);
  return { ok: true, status: 201, body: response };
}

function shouldStreamProgress(req: Request): boolean {
  const url = new URL(req.url);
  const progressFlag = url.searchParams.get("progress");
  const accept = req.headers.get("accept") || "";
  return progressFlag === "1" || accept.includes("application/x-ndjson");
}

async function respondWithImportProgress(
  req: Request,
  runner: (emit: ProgressEmitter) => Promise<ImportOutcome>
): Promise<Response> {
  if (!shouldStreamProgress(req)) {
    try {
      const outcome = await runner(() => {});
      return outcome.ok ? json(outcome.body, outcome.status) : json(outcome.body, outcome.status);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      return json({ error: message }, 500);
    }
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = async (obj: Record<string, unknown>) => {
    await writer.write(encoder.encode(`${JSON.stringify(obj)}\n`));
  };

  (async () => {
    try {
      await write({ type: "progress", step: "start", progress: 0 });
      const outcome = await runner((step, progress, detail) =>
        write({ type: "progress", step, progress, detail })
      );
      if (outcome.ok) {
        await write({ type: "result", status: outcome.status, result: outcome.body });
      } else {
        await write({ type: "error", status: outcome.status, body: outcome.body });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      await write({ type: "error", status: 500, body: { error: message } });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}
