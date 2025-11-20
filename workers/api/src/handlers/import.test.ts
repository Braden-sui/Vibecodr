/// <reference types="vitest" />
import { describe, expect, it } from "vitest";
import { bundleWithEsbuild } from "../runtime/esbuildBundler";

describe("bundleWithEsbuild", () => {
  it("bundles a simple entry and tree-shakes unused exports", async () => {
    const encoder = new TextEncoder();
    const files = new Map<string, Uint8Array>([
      ["index.js", encoder.encode("import { foo } from './foo.js'; console.log(foo);")],
      ["foo.js", encoder.encode("export const foo = 42; export const unused = 99;")],
    ]);

    const result = await bundleWithEsbuild(files, "index.js");
    expect(result.entryPoint).toBe("index.js");
    expect(result.warnings).toHaveLength(0);

    const entryFile = result.files.get(result.entryPoint);
    expect(entryFile).toBeDefined();

    const decoded = new TextDecoder().decode(entryFile!);
    expect(decoded).toContain("console.log");
    expect(decoded).toContain("42");
    expect(decoded).not.toContain("unused");
  });
});
