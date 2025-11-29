// React artifact compile helper for iframe runtime loader
// 2.3: esbuild config stub, import validator, size guard.

import { bundleWithEsbuild } from "./esbuildBundler";

/** Runtime environment types that affect import validation */
export type CompileRunnerType = "client-static" | "webcontainer" | "worker-edge";

export interface ReactCompileInput {
  code: string;
  maxBytes?: number;
  entry?: string;
  additionalFiles?: Record<string, string>;
  /**
   * Runtime environment for this artifact.
   * - "client-static": Browser sandbox (blocks Node.js builtins)
   * - "webcontainer": Node.js-like VM (allows all imports)
   * - "worker-edge": Edge worker (allows all imports)
   * Defaults to "client-static" for backwards compatibility.
   */
  runnerType?: CompileRunnerType;
}

export interface ReactCompileResult {
  ok: true;
  code: string;
  warnings: string[];
  /** List of bare npm imports discovered in the code (for dynamic import map) */
  imports: string[];
}

export interface ReactCompileError {
  ok: false;
  errorCode: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ReactCompileOutcome = ReactCompileResult | ReactCompileError;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// WHY: Block Node.js builtins that won't work in BROWSER sandbox.
// ONLY applies to client-static runtime. WebContainer/Edge runtimes allow Node.js APIs.
// These are the only imports we explicitly block for browser - everything else goes via esm.sh.
const BROWSER_BLOCKED_IMPORTS = new Set([
  // Node.js core modules
  "fs",
  "path",
  "os",
  "child_process",
  "crypto",
  "http",
  "https",
  "net",
  "dgram",
  "dns",
  "tls",
  "cluster",
  "worker_threads",
  "vm",
  "v8",
  "process",
  "buffer",
  "stream",
  "util",
  "events",
  "assert",
  "readline",
  "repl",
  "module",
  // Node.js prefixed imports
  "node:fs",
  "node:path",
  "node:os",
  "node:child_process",
  "node:crypto",
  "node:http",
  "node:https",
  "node:net",
  "node:dgram",
  "node:dns",
  "node:tls",
  "node:cluster",
  "node:worker_threads",
  "node:vm",
  "node:v8",
  "node:process",
  "node:buffer",
  "node:stream",
  "node:util",
  "node:events",
  "node:assert",
  "node:readline",
  "node:repl",
  "node:module",
]);

// INVARIANT: Caller passes already-size-gated source when using plan-aware quotas.
export async function compileReactArtifact(input: ReactCompileInput): Promise<ReactCompileOutcome> {
  const { code, maxBytes, entry = "index.tsx" } = input;
  const normalizedEntry = normalizeEntryName(entry);

  if (!code.trim()) {
    return {
      ok: false,
      errorCode: "E-VIBECODR-1100",
      message: "Artifact source is empty",
    };
  }

  // Determine if we should block Node.js imports (only for browser sandbox)
  const runnerType = input.runnerType ?? "client-static";
  const shouldBlockNodeImports = runnerType === "client-static";

  // Collect all bare imports and check for blocked ones (Node.js builtins - browser only)
  const allBareImports: string[] = [];
  const blockedImports: string[] = [];
  const filesToValidate: Array<{ path: string; content: string }> = [{ path: normalizedEntry, content: code }];
  if (input.additionalFiles) {
    for (const [path, content] of Object.entries(input.additionalFiles)) {
      filesToValidate.push({ path, content });
    }
  }

  for (const { content } of filesToValidate) {
    collectBareImports(content, allBareImports, blockedImports, shouldBlockNodeImports);
  }

  // Only reject Node.js imports for browser sandbox runtime
  if (shouldBlockNodeImports && blockedImports.length > 0) {
    return {
      ok: false,
      errorCode: "E-VIBECODR-1103",
      message: "Node.js imports are not supported in browser runtime",
      details: { imports: Array.from(new Set(blockedImports)) },
    };
  }

  // Dedupe the bare imports list
  const uniqueImports = Array.from(new Set(allBareImports));

  const files = new Map<string, Uint8Array>();
  const entryBytes = TEXT_ENCODER.encode(code);
  files.set(normalizedEntry, entryBytes);

  let totalBytes = entryBytes.byteLength;
  if (input.additionalFiles) {
    for (const [path, content] of Object.entries(input.additionalFiles)) {
      const encoded = TEXT_ENCODER.encode(content);
      files.set(path, encoded);
      totalBytes += encoded.byteLength;
    }
  }

  // INVARIANT: size guard accounts for entry and all additional files to enforce quotas.
  if (typeof maxBytes === "number" && totalBytes > maxBytes) {
    return {
      ok: false,
      errorCode: "E-VIBECODR-1110",
      message: "Artifact source exceeds allowed size budget",
      details: { size: totalBytes, maxBytes },
    };
  }

  try {
    const bundle = await bundleWithEsbuild(files, normalizedEntry);
    const compiled = bundle.files.get(bundle.entryPoint);
    if (!compiled) {
      return {
        ok: false,
        errorCode: "E-VIBECODR-1104",
        message: "Bundler did not produce an entry file",
      };
    }

    return {
      ok: true,
      code: TEXT_DECODER.decode(compiled),
      warnings: bundle.warnings,
      imports: uniqueImports,
    };
  } catch (error) {
    console.error("React artifact compile failed:", error);
    return {
      ok: false,
      errorCode: "E-VIBECODR-1105",
      message: "Failed to bundle artifact",
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

function normalizeEntryName(name: string): string {
  return name.includes(".") ? name : `${name}.tsx`;
}

/**
 * Collects all bare (npm) imports from source code.
 * Relative imports are ignored. Node.js builtins are added to blockedImports (if checkBlocked=true).
 * All other bare imports are added to allBareImports for dynamic import map generation.
 */
function collectBareImports(
  source: string,
  allBareImports: string[],
  blockedImports: string[],
  checkBlocked: boolean
) {
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    // Match: import X from 'pkg' or import { X } from 'pkg' or import 'pkg'
    const importMatch = trimmed.match(/^import\s+(?:[^"']+\s+from\s+)?['"]([^"']+)['"];?/);
    if (importMatch) {
      const spec = importMatch[1];
      processImportSpecifier(spec, allBareImports, blockedImports, checkBlocked);
      continue;
    }

    // Match: require('pkg')
    const requireMatch = trimmed.match(/require\(['"]([^'"]+)['"]\)/);
    if (requireMatch) {
      const spec = requireMatch[1];
      processImportSpecifier(spec, allBareImports, blockedImports, checkBlocked);
      continue;
    }
  }
}

function processImportSpecifier(
  specifier: string,
  allBareImports: string[],
  blockedImports: string[],
  checkBlocked: boolean
) {
  // Skip relative imports - these are internal to the project
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    return;
  }

  // Extract package name (handle scoped packages like @scope/pkg)
  const packageName = getPackageName(specifier);

  // Check if blocked (Node.js builtins) - only for browser sandbox
  if (checkBlocked && isBrowserBlockedImport(packageName)) {
    blockedImports.push(specifier);
    return;
  }

  // Track for dynamic import map
  allBareImports.push(packageName);
}

/**
 * Extract the package name from an import specifier.
 * Handles scoped packages (@scope/pkg) and subpath imports (pkg/subpath).
 */
function getPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    // Scoped package: @scope/pkg/subpath -> @scope/pkg
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  // Regular package: pkg/subpath -> pkg
  return specifier.split("/")[0];
}

function isBrowserBlockedImport(packageName: string): boolean {
  return BROWSER_BLOCKED_IMPORTS.has(packageName);
}
