/**
 * ZIP Bundle Utilities
 *
 * WHY (3.2.2): Server is the single source of truth for ZIP validation.
 * The main composer and Studio import flows send raw ZIPs directly to /import/zip.
 * Server handles all analysis, manifest generation, validation, and storage.
 *
 * PREMIUM POWER TOOL:
 * - `analyzeZipFile` is now a premium Studio power tool (Creator/Pro/Team only).
 * - It provides instant client-side preview before server upload.
 * - Does NOT replace server validation — server remains authoritative.
 * - Used by `AdvancedZipAnalyzer` component in Studio for advanced previews.
 *
 * MAIN FLOW:
 * - Main uploads use `capsulesApi.importZip()` — no client-side ZIP parsing.
 * - Server knows: max bundle size per plan, safety rules, manifest generation.
 * - Client-side manifest validation is NOT required for the main upload path.
 *
 * OTHER EXPORTS:
 * - `buildCapsuleFormData` is still used by Studio PublishTab for re-publishing.
 * - `formatBytes` is a general utility and remains in use.
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
 * PREMIUM POWER TOOL: Client-side ZIP analysis for advanced previews
 *
 * WHY (3.2.2): This function is now a premium Studio power tool for Creator/Pro/Team users.
 * It provides instant client-side preview before server upload, but does NOT replace
 * server validation. The server remains the single source of truth.
 *
 * MAIN FLOW: Use `capsulesApi.importZip(file, init)` — no client-side parsing required.
 * This function is used by `AdvancedZipAnalyzer` component for premium users only.
 *
 * Analyzes a ZIP file client-side, extracting files and validating manifest.
 * INVARIANT: Requires manifest.json in the ZIP for local validation.
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
