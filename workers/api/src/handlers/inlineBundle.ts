import { bundleWithEsbuild } from "../runtime/esbuildBundler";

export type InlineBundleResult = {
  entryPoint: string;
  content: Uint8Array;
  warnings: string[];
};

export async function bundleInlineJs(
  files: Map<string, Uint8Array>,
  entryPoint: string
): Promise<InlineBundleResult> {
  const bundled = await bundleWithEsbuild(files, entryPoint);
  const output = bundled.files.get(bundled.entryPoint);
  if (!output) {
    throw new Error(`Bundler did not produce output for entry ${bundled.entryPoint}`);
  }

  return {
    entryPoint: bundled.entryPoint,
    content: output,
    warnings: bundled.warnings,
  };
}
