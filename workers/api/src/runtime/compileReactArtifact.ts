// React artifact compile helper for iframe runtime loader
// 2.3: esbuild config stub, import validator, size guard.

import { bundleWithEsbuild } from "./esbuildBundler";

export interface ReactCompileInput {
  code: string;
  maxBytes?: number;
  entry?: string;
  additionalFiles?: Record<string, string>;
}

export interface ReactCompileResult {
  ok: true;
  code: string;
  warnings: string[];
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
// WHY: Only allow commonly used, safe frontend libraries that are also in the import map.
// INVARIANT: Keep aligned with apps/web/components/runtime/SandboxFrame.tsx import map.
const ALLOWED_IMPORTS = new Set([
  "react",
  "react-dom",
  "lucide-react",
  "recharts",
  "d3",
  "three",
  "clsx",
  "framer-motion",
  "motion",
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

  const importViolations: string[] = [];
  const filesToValidate: Array<{ path: string; content: string }> = [{ path: normalizedEntry, content: code }];
  if (input.additionalFiles) {
    for (const [path, content] of Object.entries(input.additionalFiles)) {
      filesToValidate.push({ path, content });
    }
  }

  for (const { content } of filesToValidate) {
    collectImportViolations(content, importViolations);
  }

  if (importViolations.length > 0) {
    return {
      ok: false,
      errorCode: "E-VIBECODR-1103",
      message: "Unsupported imports found in artifact source",
      details: { imports: Array.from(new Set(importViolations)) },
    };
  }

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

function collectImportViolations(source: string, importViolations: string[]) {
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    const importMatch = trimmed.match(/^import\s+[^"']+['"]([^"']+)['"];?/);
    if (importMatch) {
      const spec = importMatch[1];
      if (!isAllowedImport(spec)) {
        importViolations.push(spec);
      }
      continue;
    }

    const requireMatch = trimmed.match(/require\(['"]([^'"]+)['"]\)/);
    if (requireMatch) {
      const spec = requireMatch[1];
      if (!isAllowedImport(spec)) {
        importViolations.push(spec);
      }
      continue;
    }
  }
}

function isAllowedImport(specifier: string): boolean {
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    return true;
  }

  if (ALLOWED_IMPORTS.has(specifier)) {
    return true;
  }

  for (const allowed of ALLOWED_IMPORTS) {
    if (specifier === allowed) return true;
    if (specifier.startsWith(`${allowed}/`)) return true;
  }

  return false;
}
