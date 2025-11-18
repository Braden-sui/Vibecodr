#!/usr/bin/env node
import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
    });
    child.on("error", reject);
  });
}

async function ensureDirectoryExists(target) {
  const stats = await stat(target).catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error(`Expected directory missing: ${target}`);
    }
    throw error;
  });

  if (!stats.isDirectory()) {
    throw new Error(`Expected directory but found something else: ${target}`);
  }
}

async function removeNotFoundFunction(functionDir) {
  await rm(functionDir, { recursive: true, force: true });
  console.log(`Removed Node serverless fallback: ${functionDir}`);
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const webDir = path.join(repoRoot, "apps", "web");
  const vercelOutputDir = path.join(webDir, ".vercel", "output");
  const notFoundFunctionDir = path.join(vercelOutputDir, "functions", "_not-found.func");

  console.log("[1/3] Building Next.js output via `vercel build`...");
  await run("pnpm", ["exec", "vercel", "build"], { cwd: webDir });

  console.log("[2/3] Cleaning Node-oriented _not-found serverless function...");
  await ensureDirectoryExists(vercelOutputDir);
  await removeNotFoundFunction(notFoundFunctionDir);

  console.log("[3/3] Packaging for Cloudflare Pages via next-on-pages (skip build)...");
  await run("pnpm", ["dlx", "@cloudflare/next-on-pages", "build", "--skip-build"], { cwd: webDir });

  console.log("Cloudflare build complete. Worker bundle located in apps/web/.vercel/output/static/_worker.js");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
