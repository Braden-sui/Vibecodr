import type { BuildResult, InitializeOptions, Loader, Metafile, Plugin } from "esbuild-wasm";

const ESBUILD_WASM_URL = "https://unpkg.com/esbuild-wasm@0.24.0/esbuild.wasm";
const ESBUILD_PLUGIN_NAMESPACE = "capsule-files";
const RESOLUTION_EXTENSIONS = ["", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json"];
const TEXT_LOADER_SET = new Set<Loader>(["js", "ts", "tsx", "jsx", "json", "css", "text"]);

type EsbuildModule = typeof import("esbuild-wasm");
type EsbuildWarning = {
  text: string;
  location?: {
    file?: string;
    line?: number;
    column?: number;
  };
};
let esbuildModule: EsbuildModule | null = null;
let esbuildModulePromise: Promise<EsbuildModule> | null = null;
let esbuildInitPromise: Promise<void> | null = null;
let esbuildInitialized = false;

type EsbuildInterop = EsbuildModule & { initialize?: (options: InitializeOptions) => Promise<void> };

async function getEsbuildModule(): Promise<EsbuildInterop> {
  if (esbuildModule) {
    return esbuildModule;
  }

  if (esbuildModulePromise) {
    return esbuildModulePromise;
  }

  esbuildModulePromise = (async () => {
    const isNode =
      typeof process !== "undefined" &&
      typeof process.versions !== "undefined" &&
      typeof process.versions.node === "string";
    const preferNative = isNode && ["1", "true"].includes((process.env.VIBECODR_USE_NATIVE_ESBUILD ?? "").toLowerCase());

    if (isNode) {
      try {
        const native = (await import("esbuild")) as unknown as EsbuildInterop;
        esbuildModule = native;
        return native;
      } catch (error) {
        // WHY: Node environments (tests, dev) should strongly prefer native esbuild to avoid wasm service spawning issues.
        if (preferNative) {
          throw error;
        }
        console.warn("Falling back to esbuild-wasm after native import failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const wasmModule = (await import("esbuild-wasm")) as EsbuildInterop;
    esbuildModule = wasmModule;
    return wasmModule;
  })();

  return esbuildModulePromise;
}

export interface BundledCapsule {
  entryPoint: string;
  files: Map<string, Uint8Array>;
  warnings: string[];
}

export async function bundleWithEsbuild(
  files: Map<string, Uint8Array>,
  entryPoint: string
): Promise<BundledCapsule> {
  const normalizedEntry = normalizePath(entryPoint);

  if (normalizedEntry.endsWith(".html") || normalizedEntry.endsWith(".htm")) {
    return {
      entryPoint: normalizedEntry,
      files: cloneFiles(files),
      warnings: [],
    };
  }

  const esbuild = await getEsbuildModule();
  const normalizedFiles = buildNormalizedFileMap(files);

  if (!normalizedFiles.has(normalizedEntry)) {
    throw new Error(`Entry point ${entryPoint} not found`);
  }

  await ensureEsbuildInitialized(esbuild);

  let buildResult: BuildResult;
  try {
    buildResult = await esbuild.build({
      entryPoints: [normalizedEntry],
      bundle: true,
      platform: "browser",
      format: "esm",
      target: ["es2017"],
      outfile: normalizedEntry,
      minify: true,
      treeShaking: true,
      metafile: true,
      write: false,
      logLevel: "silent",
      // WHY: Enable React 17+ automatic JSX transform so users don't need
      // `import React from 'react'` in every file. This auto-imports the JSX runtime.
      jsx: "automatic",
      jsxImportSource: "react",
      plugins: [createEsbuildFilesystemPlugin(normalizedFiles, normalizedEntry)],
    });
  } catch (error) {
    console.error("Bundling error:", error);
    throw error;
  }

  const outputFiles = new Map<string, Uint8Array>(files);
  const buildOutputFiles = buildResult.outputFiles ?? [];
  for (const file of buildOutputFiles) {
    const normalizedPath = normalizeOutputPath(file.path);
    outputFiles.set(normalizedPath, new Uint8Array(file.contents));
  }

  const finalEntryPoint = resolveEntryOutputPath(buildResult.metafile, normalizedEntry);
  const warnings = (buildResult.warnings ?? []).map((warning) =>
    formatEsbuildWarning(warning as EsbuildWarning)
  );

  return {
    entryPoint: finalEntryPoint,
    files: outputFiles,
    warnings,
  };
}

function cloneFiles(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const cloned = new Map<string, Uint8Array>();
  for (const [path, content] of files.entries()) {
    cloned.set(path, new Uint8Array(content));
  }
  return cloned;
}

function buildNormalizedFileMap(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const normalized = new Map<string, Uint8Array>();
  for (const [path, content] of files.entries()) {
    normalized.set(normalizePath(path), content);
  }
  return normalized;
}

async function ensureEsbuildInitialized(esbuild: EsbuildInterop): Promise<void> {
  if (esbuildInitialized) {
    return;
  }

  if (esbuildInitPromise) {
    await esbuildInitPromise;
    return;
  }

  esbuildInitPromise = (async () => {
    if (typeof esbuild.initialize !== "function") {
      esbuildInitialized = true;
      return;
    }

    const initOptions: InitializeOptions = {};
    const isNode =
      typeof process !== "undefined" &&
      typeof process.versions !== "undefined" &&
      typeof process.versions.node === "string";
    if (!isNode) {
      initOptions.wasmURL = ESBUILD_WASM_URL;
    }

    await esbuild.initialize(initOptions);
    esbuildInitialized = true;
  })();

  try {
    await esbuildInitPromise;
  } catch (error) {
    esbuildInitPromise = null;
    throw error;
  }
}

function createEsbuildFilesystemPlugin(
  normalizedFiles: Map<string, Uint8Array>,
  entryPoint: string
): Plugin {
  const decoder = new TextDecoder();

  return {
    name: "capsule-files",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const specifier = stripSpecifier(args.path);
        const normalizedSpecifier = normalizePath(specifier);
        if (normalizedSpecifier === entryPoint) {
          return {
            path: normalizedSpecifier,
            namespace: ESBUILD_PLUGIN_NAMESPACE,
          };
        }
        if (isExternalSpecifier(specifier)) {
          return {
            path: specifier,
            external: true,
          };
        }

        if (isBareModuleSpecifier(specifier)) {
          return {
            path: specifier,
            external: true,
          };
        }

        const importer = args.importer ? normalizePath(args.importer) : entryPoint;
        const resolved = resolveModulePath(normalizedFiles, specifier, importer);

        if (resolved) {
          return {
            path: resolved,
            namespace: ESBUILD_PLUGIN_NAMESPACE,
          };
        }

        return {
          errors: [
            {
              text: `Could not resolve "${specifier}" imported from "${args.importer ?? entryPoint}".`,
            },
          ],
        };
      });

      build.onLoad({ filter: /.*/, namespace: ESBUILD_PLUGIN_NAMESPACE }, (args) => {
        const content = normalizedFiles.get(args.path);
        if (!content) {
          return {
            errors: [{ text: `Failed to load asset ${args.path}` }],
          };
        }

        const loader = getLoaderForPath(args.path);
        if (TEXT_LOADER_SET.has(loader)) {
          return {
            contents: decoder.decode(content),
            loader,
          };
        }

        return {
          contents: content,
          loader,
        };
      });
    },
  };
}

function resolveEntryOutputPath(metafile: Metafile | undefined, entryPoint: string): string {
  if (!metafile) {
    return entryPoint;
  }

  for (const [outputPath, outputInfo] of Object.entries(metafile.outputs)) {
    if (outputInfo.entryPoint && normalizePath(outputInfo.entryPoint) === entryPoint) {
      return normalizeOutputPath(outputPath);
    }
  }

  return entryPoint;
}

function normalizeOutputPath(outputPath: string): string {
  const normalized = normalizePath(outputPath.replace(/^\.\//, ""));
  const cwd =
    typeof process !== "undefined" && typeof process.cwd === "function"
      ? normalizePath(process.cwd())
      : "";
  if (cwd && normalized.startsWith(`${cwd}/`)) {
    return normalized.slice(cwd.length + 1);
  }
  return normalized;
}

function formatEsbuildWarning(warning: EsbuildWarning): string {
  if (!warning) {
    return "esbuild: unknown warning";
  }

  const location = warning.location;
  if (location?.file) {
    const file = location.file.replace(/^\.\//, "");
    const line = location.line ? `:${location.line}` : "";
    return `${file}${line} ${warning.text}`;
  }

  return warning.text;
}

function stripSpecifier(specifier: string): string {
  return specifier.split(/[?#]/)[0];
}

function isExternalSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("//") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("file:")
  );
}

function isBareModuleSpecifier(specifier: string): boolean {
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    return false;
  }
  if (specifier.includes(":")) {
    return false;
  }
  return true;
}

function resolveModulePath(
  normalizedFiles: Map<string, Uint8Array>,
  rawSpecifier: string,
  importer: string
): string | null {
  const stripped = stripSpecifier(rawSpecifier);
  const normalizedSpecifier = stripped.replace(/\\/g, "/");

  const baseDir = getDirectory(importer);
  const candidateBase = normalizedSpecifier.startsWith("/")
    ? normalizedSpecifier.slice(1)
    : baseDir
    ? `${baseDir}/${normalizedSpecifier}`
    : normalizedSpecifier;

  const normalizedBase = normalizePath(candidateBase);
  if (!normalizedBase) {
    return null;
  }

  const candidates = new Set<string>();
  candidates.add(normalizedBase);
  const hasExtension = /\.[^./]+$/.test(normalizedBase);

  if (!hasExtension) {
    for (const ext of RESOLUTION_EXTENSIONS) {
      candidates.add(`${normalizedBase}${ext}`);
    }
  }

  for (const ext of RESOLUTION_EXTENSIONS) {
    candidates.add(`${normalizedBase}/index${ext}`);
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizePath(candidate);
    if (!normalizedCandidate) {
      continue;
    }
    if (normalizedFiles.has(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return null;
}

function getDirectory(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function getLoaderForPath(filePath: string): Loader {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) {
    return "tsx";
  }
  if (lower.endsWith(".ts")) {
    return "ts";
  }
  if (lower.endsWith(".jsx")) {
    return "jsx";
  }
  if (lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".js")) {
    return "js";
  }
  if (lower.endsWith(".json")) {
    return "json";
  }
  if (lower.endsWith(".css")) {
    return "css";
  }
  if (
    lower.endsWith(".wasm") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".avif") ||
    lower.endsWith(".bmp") ||
    lower.endsWith(".ico") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".woff") ||
    lower.endsWith(".woff2")
  ) {
    return "file";
  }
  return "text";
}

function normalizePath(value: string): string {
  const segments: string[] = [];
  const parts = value.replace(/\\/g, "/").split("/");
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}
