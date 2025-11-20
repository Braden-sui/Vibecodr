#!/usr/bin/env node

import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const indexPath = path.join(rootDir, "public", "runtime-assets", "runtime-index.json");

function computeChecksum(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  const requireChecksums = process.env.RUNTIME_ASSETS_REQUIRE_CHECKSUMS === "1";
  const writeMissing = process.env.RUNTIME_ASSETS_WRITE_CHECKSUMS === "1";

  const raw = await readFile(indexPath, "utf8");
  const index = JSON.parse(raw);

  let mutated = false;
  let hadError = false;

  const versions = Array.isArray(index.versions) ? index.versions : [];

  for (const version of versions) {
    const versionId = version.version || "unknown";
    const assets = version.assets || {};

    for (const [name, entry] of Object.entries(assets)) {
      const info = typeof entry === "string" ? { path: entry } : entry;
      const relPath = info.path;

      if (!relPath) {
        console.error(
          `[runtime-assets] missing path for ${versionId}:${name} in runtime-index.json`
        );
        hadError = true;
        continue;
      }

      const assetPath = path.join(rootDir, "public", relPath);
      const content = await readFile(assetPath);
      const digest = computeChecksum(content);

      const existing = typeof info.checksum === "string" ? info.checksum : null;

      if (existing && existing !== digest) {
        console.error(
          `[runtime-assets] checksum mismatch for ${versionId}:${name} (${relPath})` +
            `\n  index:    ${existing}\n  computed: ${digest}`
        );
        hadError = true;
        if (writeMissing) {
          info.checksum = digest;
          mutated = true;
          hadError = false;
        }
      } else if (!existing && writeMissing) {
        info.checksum = digest;
        mutated = true;
      }

      if (typeof entry === "string") {
        version.assets[name] = info;
        mutated = true;
      }
    }
  }

  if (mutated) {
    await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
    console.log("[runtime-assets] runtime-index.json updated with checksums.");
  }

  if (requireChecksums && hadError) {
    console.error("[runtime-assets] One or more checksum mismatches detected.");
    process.exit(1);
  }

  console.log("[runtime-assets] Validation OK.");
}

main().catch((err) => {
  console.error("[runtime-assets] validation failed", err);
  process.exit(1);
});
