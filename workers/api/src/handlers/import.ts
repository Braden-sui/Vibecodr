/**
 * Import handlers for GitHub and ZIP uploads
 * Implements the import pipeline: Download → Analyze → Build → Upload
 * Based on research-github-import-storage.md
 */

import JSZip from "jszip";
import { validateManifest, type Manifest } from "@vibecodr/shared/manifest";
import type { Env, Handler } from "../index";
import { requireAuth, type AuthenticatedUser } from "../auth";
import {
  persistCapsuleBundle,
  sanitizeHtmlEntryIfNeeded,
  type PublishWarning,
  PublishCapsuleError,
  enforceSafetyForFiles,
} from "./capsules";
import { getUserRunQuotaState } from "../storage/quotas";
import type { CapsuleFile } from "../storage/r2";
import { bundleWithEsbuild } from "../runtime/esbuildBundler";

interface AnalysisResult {
  entryPoint: string;
  files: Map<string, Uint8Array>;
  totalSize: number;
  detectedLicense?: string;
  hasServerCode: boolean;
  warnings: string[];
}

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
    });

    if (analysis.totalSize > 25 * 1024 * 1024) {
      return json(
        {
          success: false,
          error: "Bundle size exceeds 25 MB limit (Free/Creator plan)",
          totalSize: analysis.totalSize,
        },
        400
      );
    }

    if (analysis.hasServerCode) {
      analysis.warnings.push("Server-side code detected. Only client-side code will run.");
    }

    // Bundle with esbuild-wasm
    const {
      files: bundledFiles,
      entryPoint: bundledEntryPoint,
      warnings: bundlerWarnings,
    } = await bundleWithEsbuild(analysis.files, analysis.entryPoint);

    const analysisForManifest: AnalysisResult = {
      ...analysis,
      entryPoint: bundledEntryPoint,
    };

    // Generate manifest
    const manifest = await generateManifest(bundledFiles, analysisForManifest);

    // Validate manifest
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return json(
        {
          success: false,
          errors: validation.errors,
          warnings: validation.warnings,
        },
        400
      );
    }

    const manifestText = JSON.stringify(manifest, null, 2);
    const files = convertBundledMapToCapsuleFiles(bundledFiles);
    const manifestBytes = new TextEncoder().encode(manifestText);
    files.push({
      path: "manifest.json",
      content: manifestBytes.buffer as ArrayBuffer,
      contentType: "application/json",
      size: manifestBytes.byteLength,
    });

    const validationWarnings = validation.warnings ?? [];
    const analysisWarnings =
      analysisForManifest.warnings?.map<PublishWarning>((message, index) => ({
        path: `analysis.${index}`,
        message,
      })) ?? [];
    const bundlerWarningEntries = bundlerWarnings.map<PublishWarning>((message, index) => ({
      path: `bundle.${index}`,
      message,
    }));
    const combinedWarnings =
      validationWarnings.length === 0 &&
      analysisWarnings.length === 0 &&
      bundlerWarningEntries.length === 0
        ? undefined
        : [...analysisWarnings, ...bundlerWarningEntries, ...validationWarnings];

    let publishResult;
    try {
      await enforceSafetyForFiles(env, manifest, files);
      const sanitized = sanitizeHtmlEntryIfNeeded(files, manifest);
      publishResult = await persistCapsuleBundle({
        env,
        user,
        manifest,
        manifestText,
        files: sanitized.files,
        totalSize: sanitized.totalSize,
        warnings: combinedWarnings,
      });
    } catch (err) {
      if (err instanceof PublishCapsuleError) {
        return json(err.body, err.status);
      }
      throw err;
    }

    return json({
      success: true,
      capsuleId: publishResult.capsule.id,
      capsule: publishResult.capsule,
      artifact: publishResult.artifact,
      warnings: publishResult.warnings,
      manifest,
    });
  } catch (error) {
    console.error("GitHub import error:", error);
    return json(
      {
        success: false,
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

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const fileEntry = formData.get("file");

      if (!fileEntry || typeof fileEntry === "string") {
        return json({ success: false, error: "No file uploaded" }, 400);
      }

      const file = fileEntry as File;

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
          success: false,
          error: "ZIP file exceeds 250 MB limit",
        },
        400
      );
    }

    // Analyze ZIP contents
    const analysis = await analyzeArchive(new Uint8Array(zipBuffer));

    if (analysis.totalSize > 25 * 1024 * 1024) {
      return json(
        {
          success: false,
          error: "Extracted bundle size exceeds 25 MB limit (Free/Creator plan)",
          totalSize: analysis.totalSize,
        },
        400
      );
    }

    // Bundle with esbuild-wasm
    const {
      files: bundledFiles,
      entryPoint: bundledEntryPoint,
      warnings: bundlerWarnings,
    } = await bundleWithEsbuild(analysis.files, analysis.entryPoint);

    const analysisForManifest: AnalysisResult = {
      ...analysis,
      entryPoint: bundledEntryPoint,
    };

    // Generate manifest
    const manifest = await generateManifest(bundledFiles, analysisForManifest);

    // Validate manifest
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return json(
        {
          success: false,
          errors: validation.errors,
          warnings: validation.warnings,
        },
        400
      );
    }

    const manifestText = JSON.stringify(manifest, null, 2);
    const files = convertBundledMapToCapsuleFiles(bundledFiles);
    const manifestBytes = new TextEncoder().encode(manifestText);
    files.push({
      path: "manifest.json",
      content: manifestBytes.buffer as ArrayBuffer,
      contentType: "application/json",
      size: manifestBytes.byteLength,
    });

    const validationWarnings = validation.warnings ?? [];
    const analysisWarnings =
      analysisForManifest.warnings?.map<PublishWarning>((message, index) => ({
        path: `analysis.${index}`,
        message,
      })) ?? [];
    const bundlerWarningEntries = bundlerWarnings.map<PublishWarning>((message, index) => ({
      path: `bundle.${index}`,
      message,
    }));
    const combinedWarnings =
      validationWarnings.length === 0 &&
      analysisWarnings.length === 0 &&
      bundlerWarningEntries.length === 0
        ? undefined
        : [...analysisWarnings, ...bundlerWarningEntries, ...validationWarnings];

    let publishResult;
    try {
      await enforceSafetyForFiles(env, manifest, files);
      const sanitized = sanitizeHtmlEntryIfNeeded(files, manifest);
      publishResult = await persistCapsuleBundle({
        env,
        user,
        manifest,
        manifestText,
        files: sanitized.files,
        totalSize: sanitized.totalSize,
        warnings: combinedWarnings,
      });
    } catch (err) {
      if (err instanceof PublishCapsuleError) {
        return json(err.body, err.status);
      }
      throw err;
    }

    return json({
      success: true,
      capsuleId: publishResult.capsule.id,
      capsule: publishResult.capsule,
      artifact: publishResult.artifact,
      warnings: publishResult.warnings,
      manifest,
    });
  } catch (error) {
    console.error("ZIP import error:", error);
    return json(
      {
        success: false,
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
  options?: { stripPrefix?: string }
): Promise<AnalysisResult> {
  const zip = await JSZip.loadAsync(buffer);
  const files = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  let totalSize = 0;
  let detectedLicense: string | undefined;
  let hasServerCode = false;

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

  // Detect entry point
  const entryPoint = detectEntryPoint(files);

  if (!entryPoint) {
    throw new Error("Could not detect entry point (index.html, main.js, etc.)");
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
  };
}

/**
 * Detect entry point from file list
 */
function detectEntryPoint(files: Map<string, Uint8Array>): string | null {
  // Priority order for entry points
  const candidates = [
    "index.html",
    "main.html",
    "index.htm",
    "main.js",
    "index.js",
    "app.js",
    "bundle.js",
    "dist/index.html",
    "dist/main.html",
    "build/index.html",
    "public/index.html",
  ];

  for (const candidate of candidates) {
    if (files.has(candidate)) {
      return candidate;
    }
  }

  // Fallback: find any HTML file
  for (const path of files.keys()) {
    if (path.endsWith(".html") || path.endsWith(".htm")) {
      return path;
    }
  }

  return null;
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
  // Detect parameters from entry file if it's HTML
  const params: Manifest["params"] = [];

  if (analysis.entryPoint.endsWith(".html")) {
    const html = new TextDecoder().decode(files.get(analysis.entryPoint));
    // Simple parameter detection from HTML comments or data attributes
    // In production, this would be more sophisticated
  }

  return {
    version: "1.0",
    runner: "client-static",
    entry: analysis.entryPoint,
    title: "Imported Capsule",
    description: "Imported from GitHub or ZIP",
    params,
    capabilities: {
      storage: false,
      workers: false,
    },
    license: analysis.detectedLicense,
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

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
