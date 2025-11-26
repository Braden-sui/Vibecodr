/**
 * ZIP Bundle Utilities
 *
 * WHY: Phase 3 (Option B) moved ZIP analysis to the server.
 * The main composer and Studio import flows now send raw ZIPs directly to /import/zip.
 * Server handles all analysis, manifest generation, validation, and storage.
 *
 * DEPRECATION NOTICE:
 * - `analyzeZipFile` is deprecated for main flows. Server handles this now.
 * - `buildCapsuleFormData` is still used by Studio PublishTab for re-publishing edited capsules.
 * - `formatBytes` is a general utility and remains in use.
 *
 * For new code, prefer server-side ZIP processing via `capsulesApi.importZip()`.
 */

import JSZip from "jszip";
import { validateManifest, type Manifest } from "@vibecodr/shared/manifest";

export interface ZipManifestIssue {
  path: string;
  message: string;
}

export interface ExtractedZipFile {
  path: string;
  type: string;
  size: number;
  file: File;
}

export interface ZipAnalysisResult {
  manifest: Manifest;
  files: ExtractedZipFile[];
  warnings?: ZipManifestIssue[];
  errors?: ZipManifestIssue[];
  totalSize: number;
}

/**
 * @deprecated Phase 3 (Option B): Server now handles ZIP analysis via /import/zip.
 * Use `capsulesApi.importZip(file, init)` for main flows.
 * This function remains for backwards compatibility and edge cases.
 *
 * Analyzes a ZIP file client-side, extracting files and validating manifest.
 * INVARIANT: Requires manifest.json in the ZIP (legacy behavior).
 */
export async function analyzeZipFile(file: File): Promise<ZipAnalysisResult> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !entry.name.startsWith("__MACOSX/")
  );

  if (entries.length === 0) {
    throw new Error("ZIP archive is empty.");
  }

  const rootPrefix = detectCommonRoot(entries.map((entry) => entry.name));
  const extracted: ExtractedZipFile[] = [];
  let manifestData: Manifest | undefined;
  let manifestWarnings: ZipManifestIssue[] | undefined;
  let manifestErrors: ZipManifestIssue[] | undefined;
  let totalSize = 0;

  for (const entry of entries) {
    const cleanPath = normalizePath(entry.name, rootPrefix);
    if (!cleanPath) continue;

    if (cleanPath.toLowerCase() === "manifest.json" && !manifestData) {
      const manifestText = await entry.async("text");
      try {
        manifestData = JSON.parse(manifestText);
      } catch {
        throw new Error("manifest.json is not valid JSON.");
      }

      const manifestFile = new File([manifestText], "manifest.json", {
        type: "application/json",
      });

      extracted.push({
        path: "manifest.json",
        type: "application/json",
        size: manifestText.length,
        file: manifestFile,
      });
      totalSize += manifestText.length;
      continue;
    }

    const arrayBuffer = await entry.async("arraybuffer");
    const contentType = guessContentType(cleanPath);
    const blobFile = new File([arrayBuffer], cleanPath.split("/").pop() ?? cleanPath, {
      type: contentType,
    });

    extracted.push({
      path: cleanPath,
      type: contentType,
      size: arrayBuffer.byteLength,
      file: blobFile,
    });
    totalSize += arrayBuffer.byteLength;
  }

  if (!manifestData) {
    throw new Error("manifest.json is required in the ZIP file.");
  }

  const validation = validateManifest(manifestData);
  if (!validation.valid && validation.errors) {
    manifestErrors = validation.errors.map((err) => ({
      path: err.path,
      message: err.message,
    }));
  }

  if (validation.warnings) {
    manifestWarnings = validation.warnings.map((warning) => ({
      path: warning.path,
      message: warning.message,
    }));
  }

  return {
    manifest: manifestData,
    files: extracted,
    warnings: manifestWarnings,
    errors: manifestErrors,
    totalSize,
  };
}

/**
 * Builds FormData for capsule publish endpoint from extracted files.
 * Still used by Studio PublishTab for re-publishing edited capsules.
 * For new imports, use server-side processing via `capsulesApi.importZip()`.
 */
export function buildCapsuleFormData(manifest: Manifest, files: ExtractedZipFile[]): FormData {
  const formData = new FormData();
  let hasManifest = false;

  for (const file of files) {
    if (file.path.toLowerCase() === "manifest.json") {
      formData.append("manifest", file.file, "manifest.json");
      hasManifest = true;
    } else {
      formData.append(file.path, file.file, file.path);
    }
  }

  if (!hasManifest) {
    const manifestBlob = new File([JSON.stringify(manifest, null, 2)], "manifest.json", {
      type: "application/json",
    });
    formData.append("manifest", manifestBlob, "manifest.json");
  }

  return formData;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function detectCommonRoot(paths: string[]): string | undefined {
  const candidates = paths
    .map((path) => {
      const idx = path.indexOf("/");
      return idx === -1 ? null : path.slice(0, idx + 1);
    })
    .filter((value): value is string => Boolean(value));

  if (candidates.length === 0) return undefined;
  const first = candidates[0];
  return candidates.every((candidate) => candidate === first) ? first : undefined;
}

function normalizePath(path: string, prefix?: string): string | null {
  let clean = path;
  if (prefix && clean.startsWith(prefix)) {
    clean = clean.slice(prefix.length);
  }
  clean = clean.replace(/^\.\/+/, "");
  if (!clean) return null;
  return clean;
}

function guessContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const lookup: Record<string, string> = {
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
    webp: "image/webp",
    ico: "image/x-icon",
    txt: "text/plain",
  };
  return lookup[ext] ?? "application/octet-stream";
}
