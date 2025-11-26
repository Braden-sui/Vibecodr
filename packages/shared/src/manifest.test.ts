import { describe, it, expect } from "vitest";
import { collectEntryCandidates, manifestSchema, validateManifest, type Manifest } from "./manifest";
import { ERROR_MANIFEST_INVALID, ERROR_MANIFEST_TOO_LARGE } from "./errors";

describe("Manifest Validation", () => {
  const baseManifest: Manifest = {
    version: "1.0",
    runner: "client-static",
    entry: "index.html",
  };

  describe("manifestSchema", () => {
    it("should validate a minimal valid manifest", () => {
      const result = manifestSchema.safeParse(baseManifest);
      expect(result.success).toBe(true);
    });

    it("should validate manifest with all param types", () => {
      const manifest: Manifest = {
        ...baseManifest,
        params: [
          {
            name: "count",
            type: "slider",
            label: "Count",
            default: 50,
            min: 0,
            max: 100,
            step: 1,
          },
          {
            name: "enabled",
            type: "toggle",
            label: "Enabled",
            default: true,
          },
          {
            name: "mode",
            type: "select",
            label: "Mode",
            default: "normal",
            options: ["fast", "normal", "slow"],
          },
          {
            name: "name",
            type: "text",
            label: "Name",
            default: "Hello",
          },
          {
            name: "opacity",
            type: "number",
            label: "Opacity",
            default: 0.5,
            min: 0,
            max: 1,
            step: 0.1,
          },
          {
            name: "color",
            type: "color",
            label: "Color",
            default: "#ff0000",
          },
        ],
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });

    it("should validate manifest with capabilities", () => {
      const manifest: Manifest = {
        ...baseManifest,
        capabilities: {
          net: ["api.example.com", "cdn.example.com"],
          storage: true,
          workers: true,
          concurrency: {
            previews: 1,
            player: 2,
          },
        },
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });

    it("should reject invalid version", () => {
      const manifest = {
        version: "2.0",
        runner: "client-static",
        entry: "index.html",
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("should reject invalid runner type", () => {
      const manifest = {
        version: "1.0",
        runner: "invalid-runner",
        entry: "index.html",
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("should reject more than 20 params", () => {
      const manifest: Manifest = {
        version: "1.0",
        runner: "client-static",
        entry: "index.html",
        params: Array.from({ length: 21 }, (_, i) => ({
          name: `param${i}`,
          type: "text" as const,
          label: `Param ${i}`,
          default: "test",
        })),
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("should reject slider without min/max", () => {
      const manifest = {
        version: "1.0",
        runner: "client-static",
        entry: "index.html",
        params: [{ name: "count", type: "slider", default: 50 }],
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("should reject select without options", () => {
      const manifest = {
        version: "1.0",
        runner: "client-static",
        entry: "index.html",
        params: [{ name: "mode", type: "select", default: "fast" }],
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("should require edgeWorker config for worker-edge runner", () => {
      const manifest: Manifest = {
        ...baseManifest,
        runner: "worker-edge",
        edgeWorker: {
          entry: "worker.ts",
          concurrency: 2,
        },
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });
  });

  describe("validateManifest", () => {
    it("should return valid result for good manifest", () => {
      const result = validateManifest(baseManifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should return errors for invalid manifest", () => {
      const manifest = {
        version: "1.0",
        runner: "client-static",
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]?.errorCode).toBe(ERROR_MANIFEST_INVALID);
    });

    it("should set errorCode when bundle size exceeds limit", () => {
      const manifest: Manifest = {
        ...baseManifest,
        bundleSize: 26 * 1024 * 1024,
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(
        result.errors?.some(
          (err) => err.path === "bundleSize" && err.errorCode === ERROR_MANIFEST_TOO_LARGE
        )
      ).toBe(true);
    });

    it("should reject manifests that request network access", () => {
      const manifest: Manifest = {
        ...baseManifest,
        capabilities: {
          storage: false,
          workers: false,
          net: ["api.example.com"],
        },
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(
        result.errors?.some(
          (err) => err.path === "capabilities.net" && err.errorCode === ERROR_MANIFEST_INVALID
        )
      ).toBe(true);
    });

    it("should reject worker-edge manifest without configuration", () => {
      const manifest: Manifest = {
        ...baseManifest,
        runner: "worker-edge",
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((err) => err.path === "edgeWorker")).toBe(true);
    });

    it("should provide warning when live waitlist missing plan", () => {
      const manifest: Manifest = {
        ...baseManifest,
        live: {
          enabled: true,
          waitlistOnly: true,
        },
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
    });
  });

  describe("collectEntryCandidates", () => {
    it("returns sorted entry file candidates with allowed extensions", () => {
      const paths = ["app.js", "index.html", "notes.txt", "src/main.tsx", "README.md"];
      expect(collectEntryCandidates(paths)).toEqual(["app.js", "index.html", "src/main.tsx"]);
    });

    it("handles mixed case extensions", () => {
      const paths = ["INDEX.HTML", "App.JS", "styles.CSS"];
      expect(collectEntryCandidates(paths)).toEqual(["App.JS", "INDEX.HTML"]);
    });
  });
});
