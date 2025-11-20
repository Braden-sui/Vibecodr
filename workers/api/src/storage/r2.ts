/**
 * R2 Storage Structure and Integrity Utilities
 * Based on research-github-import-storage.md
 * Implements immutable storage with content-hash keys
 */

/**
 * R2 Storage Structure:
 *
 * capsules/{contentHash}/
 *   ├── manifest.json          - Capsule manifest (validated)
 *   ├── {entryFile}            - Main entry file (index.html, main.js, etc.)
 *   ├── assets/
 *   │   ├── main.js
 *   │   ├── styles.css
 *   │   └── images/
 *   │       └── logo.png
 *   └── metadata.json          - Storage metadata (upload time, size, etc.)
 *
 * drafts/{userId}/{draftId}/   - Work-in-progress capsules
 *   └── ... (same structure)
 */

import type { Manifest } from "@vibecodr/shared/manifest";

export interface StorageMetadata {
  uploadedAt: number;
  totalSize: number;
  fileCount: number;
  contentHash: string;
  owner: string;
}

export interface CapsuleFile {
  path: string;
  content: ArrayBuffer | string;
  contentType: string;
  size: number;
}

/**
 * Generate SHA-256 content hash for integrity verification
 * Uses Web Crypto API available in Workers
 */
export async function generateContentHash(content: string | ArrayBuffer): Promise<string> {
  const encoder = new TextEncoder();
  const data = typeof content === "string" ? encoder.encode(content) : content;
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate content hash for entire capsule bundle
 * Combines all file hashes in deterministic order
 */
export async function generateBundleHash(files: CapsuleFile[]): Promise<string> {
  // Sort files by path for deterministic hash
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  // Concatenate all file hashes
  const fileHashes = await Promise.all(
    sortedFiles.map(async (file) => {
      const content: string | ArrayBuffer = typeof file.content === "string"
        ? file.content
        : file.content;
      return await generateContentHash(content);
    })
  );

  // Hash the combined hashes
  const combined = fileHashes.join("");
  return await generateContentHash(combined);
}

/**
 * Get R2 key for capsule file
 */
export function getCapsuleKey(contentHash: string, filePath: string): string {
  // Remove leading slash if present
  const cleanPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  return `capsules/${contentHash}/${cleanPath}`;
}

/**
 * Get R2 key for draft file
 */
export function getDraftKey(userId: string, draftId: string, filePath: string): string {
  const cleanPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
  return `drafts/${userId}/${draftId}/${cleanPath}`;
}

/**
 * Verify capsule integrity by comparing stored hash with computed hash
 */
export async function verifyCapsuleIntegrity(
  r2: R2Bucket,
  contentHash: string,
  expectedHash: string
): Promise<boolean> {
  if (contentHash !== expectedHash) {
    return false;
  }

  // Verify manifest exists and is valid
  const manifestKey = getCapsuleKey(contentHash, "manifest.json");
  const manifestObj = await r2.get(manifestKey);

  if (!manifestObj) {
    return false;
  }

  // Verify metadata exists
  const metadataKey = getCapsuleKey(contentHash, "metadata.json");
  const metadataObj = await r2.get(metadataKey);

  if (!metadataObj) {
    return false;
  }

  const metadata = await metadataObj.json<StorageMetadata>();

  // Verify stored hash matches
  return metadata.contentHash === expectedHash;
}

/**
 * Upload capsule bundle to R2 with integrity hash
 */
export async function uploadCapsuleBundle(
  r2: R2Bucket,
  files: CapsuleFile[],
  manifest: Manifest,
  owner: string
): Promise<{ contentHash: string; totalSize: number; fileCount: number }> {
  // Generate bundle hash
  const contentHash = await generateBundleHash(files);

  // Calculate total size
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  // Upload all files
  const uploadPromises = files.map(async (file) => {
    const key = getCapsuleKey(contentHash, file.path);

    // Body to upload
    const body: ArrayBuffer | Uint8Array = typeof file.content === "string"
      ? new TextEncoder().encode(file.content)
      : file.content;

    await r2.put(key, body, {
      httpMetadata: {
        contentType: file.contentType,
      },
      customMetadata: {
        path: file.path,
        size: file.size.toString(),
        // Hash must use string or ArrayBuffer (not Uint8Array)
        hash: await generateContentHash(
          typeof file.content === "string"
            ? file.content
            : file.content
        ),
      },
    });
  });

  // Upload manifest
  const manifestKey = getCapsuleKey(contentHash, "manifest.json");
  await r2.put(manifestKey, JSON.stringify(manifest, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });

  // Upload metadata
  const metadata: StorageMetadata = {
    uploadedAt: Date.now(),
    totalSize,
    fileCount: files.length,
    contentHash,
    owner,
  };
  const metadataKey = getCapsuleKey(contentHash, "metadata.json");
  await r2.put(metadataKey, JSON.stringify(metadata, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });

  // Wait for all uploads
  await Promise.all(uploadPromises);

  return { contentHash, totalSize, fileCount: files.length };
}

/**
 * Download capsule file from R2 with integrity check
 */
export async function downloadCapsuleFile(
  r2: R2Bucket,
  contentHash: string,
  filePath: string,
  verifyHash = true
): Promise<R2ObjectBody | null> {
  const key = getCapsuleKey(contentHash, filePath);
  const object = await r2.get(key);

  if (!object) {
    return null;
  }

  if (verifyHash && object.customMetadata?.hash) {
    // Verify file integrity
    const content = await object.arrayBuffer();
    const computedHash = await generateContentHash(content);

    if (computedHash !== object.customMetadata.hash) {
      throw new Error(`Integrity check failed for ${filePath}`);
    }

    // Re-fetch since we consumed the stream
    return await r2.get(key);
  }

  return object;
}

/**
 * List all files in a capsule
 */
export async function listCapsuleFiles(
  r2: R2Bucket,
  contentHash: string
): Promise<Array<{ path: string; size: number; hash: string }>> {
  const prefix = `capsules/${contentHash}/`;
  const listed = await r2.list({ prefix });

  return listed.objects
    .filter((obj) => !obj.key.endsWith("metadata.json")) // Exclude metadata
    .map((obj) => ({
      path: obj.key.replace(prefix, ""),
      size: obj.size,
      hash: obj.customMetadata?.hash || "",
    }));
}

/**
 * Delete capsule from R2 (admin only)
 */
export async function deleteCapsuleBundle(
  r2: R2Bucket,
  contentHash: string
): Promise<void> {
  const prefix = `capsules/${contentHash}/`;
  const listed = await r2.list({ prefix });

  const deletePromises = listed.objects.map((obj) => r2.delete(obj.key));
  await Promise.all(deletePromises);
}

/**
 * Get capsule metadata
 */
export async function getCapsuleMetadata(
  r2: R2Bucket,
  contentHash: string
): Promise<StorageMetadata | null> {
  const key = getCapsuleKey(contentHash, "metadata.json");
  const object = await r2.get(key);

  if (!object) {
    return null;
  }

  return await object.json<StorageMetadata>();
}
