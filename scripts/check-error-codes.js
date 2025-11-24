#!/usr/bin/env node
/**
 * WHY: Enforce that every E-VIBECODR-#### code used in the repo is defined in the central registry,
 * and that registry codes are actually referenced somewhere. Fails lint on drift.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "packages", "shared", "src", "errors.ts");
const CODE_REGEX = /E-VIBECODR-\d{4}/g;

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".output",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".pnpm-store",
  ".wrangler",
  ".idea",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".bz2",
  ".br",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".map",
]);

function collectRegistryCodes() {
  const content = fs.readFileSync(REGISTRY_PATH, "utf8");
  const matches = content.match(CODE_REGEX) || [];
  return new Set(matches);
}

function shouldSkipDir(entry) {
  return entry.isDirectory() && SKIP_DIRS.has(entry.name);
}

function shouldSkipFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function collectUsedCodes() {
  const used = new Set();
  const stack = [ROOT];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (shouldSkipDir(entry)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (shouldSkipFile(fullPath)) continue;

      let content;
      try {
        content = fs.readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }

      const matches = content.match(CODE_REGEX);
      if (!matches) continue;
      for (const code of matches) {
        used.add(code);
      }
    }
  }

  return used;
}

function main() {
  const registry = collectRegistryCodes();
  const used = collectUsedCodes();

  const missing = [...used].filter((code) => !registry.has(code)).sort();
  const unused = [...registry].filter((code) => !used.has(code)).sort();

  if (missing.length || unused.length) {
    if (missing.length) {
      console.error("E-VIBECODR codes used but not defined:", missing.join(", "));
    }
    if (unused.length) {
      console.error("E-VIBECODR codes defined but not used:", unused.join(", "));
    }
    process.exit(1);
  } else {
    console.info("E-VIBECODR registry matches all usages.");
  }
}

main();
