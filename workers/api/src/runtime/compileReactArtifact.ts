// React artifact compile helper for iframe runtime loader
// 2.3: esbuild config stub, import validator, size guard.

export interface ReactCompileInput {
  code: string;
  maxBytes?: number;
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

// Minimal initial allowlist based on docs; can be extended by later work.
const ALLOWED_IMPORTS = new Set([
  "react",
  "react-dom",
  "lucide-react",
  "recharts",
  "d3",
  "three",
  "clsx",
]);

// INVARIANT: Caller passes already-size-gated source when using plan-aware quotas.
export function compileReactArtifact(input: ReactCompileInput): ReactCompileOutcome {
  const { code, maxBytes } = input;

  if (!code.trim()) {
    return {
      ok: false,
      errorCode: "E-VIBECODR-1100",
      message: "Artifact source is empty",
    };
  }

  const size = new TextEncoder().encode(code).byteLength;
  if (typeof maxBytes === "number" && size > maxBytes) {
    return {
      ok: false,
      errorCode: "E-VIBECODR-1110",
      message: "Artifact source exceeds allowed size budget",
      details: { size, maxBytes },
    };
  }

  const importViolations: string[] = [];

  // Very small, line-based import scan for now.
  const lines = code.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    // Handle `import x from "pkg";` and `import {x} from 'pkg';`
    const importMatch = trimmed.match(/^import\s+[^"']+['"]([^"']+)['"];?/);
    if (importMatch) {
      const spec = importMatch[1];
      if (!isAllowedImport(spec)) {
        importViolations.push(spec);
      }
      continue;
    }

    // Handle `require("pkg")` style usage conservatively.
    const requireMatch = trimmed.match(/require\(['"]([^'\"]+)['"]\)/);
    if (requireMatch) {
      const spec = requireMatch[1];
      if (!isAllowedImport(spec)) {
        importViolations.push(spec);
      }
      continue;
    }
  }

  if (importViolations.length > 0) {
    return {
      ok: false,
      errorCode: "E-VIBECODR-1103",
      message: "Unsupported imports found in artifact source",
      details: { imports: Array.from(new Set(importViolations)) },
    };
  }

  // NOTE: esbuild-wasm integration will be added later by the broader pipeline work.
  // For 2.3, we return the original code once it passes validation so downstream
  // steps (HTML pipeline, manifest emission) can be implemented independently.

  return {
    ok: true,
    code,
    warnings: [],
  };
}

function isAllowedImport(specifier: string): boolean {
  // Allow relative/absolute paths; bundler resolves them outside the allowlist policy.
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    return true;
  }

  // Bare specifiers must be explicitly allowed.
  if (ALLOWED_IMPORTS.has(specifier)) {
    return true;
  }

  // Simple namespace allowance, e.g. "d3-scale" under "d3" umbrella.
  for (const allowed of ALLOWED_IMPORTS) {
    if (specifier === allowed) return true;
    if (specifier.startsWith(`${allowed}/`)) return true;
  }

  return false;
}
