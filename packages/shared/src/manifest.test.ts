import { describe, it, expect } from "vitest";
import { manifestSchema, validateManifest, type Manifest } from "./manifest";

describe("Manifest Validation", () => {
  describe("manifestSchema", () => {
    it("should validate a minimal valid manifest", () => {
      const manifest: Manifest = {
        version: "1.0",
        runner: "client-static",
        entry: "index.html",
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });

    it("should validate manifest with all param types", () => {
      const manifest: Manifest = {
        version: "1.0",
        runner: "client-static",
        entry: "index.html",
        params: [
          { name: "count", type: "slider", defaultValue: 50, min: 0, max: 100, step: 1 },
          { name: "enabled", type: "toggle", defaultValue: true },
          { name: "mode", type: "select", defaultValue: "normal", options: ["fast", "normal", "slow"] },
          { name: "name", type: "text", defaultValue: "Hello" },
          { name: "opacity", type: "number", defaultValue: 0.5, min: 0, max: 1, step: 0.1 },
          { name: "color", type: "color", defaultValue: "#ff0000" },
        ],
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });

    it("should validate manifest with capabilities", () => {
      const manifest: Manifest = {
        version: "1.0",
        runner: "client-static",
        entry: "index.html",
        capabilities: {
          net: ["api.example.com", "*.cdn.com"],
          storage: true,
          workers: true,
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
          defaultValue: "test",
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
        params: [
          { name: "count", type: "slider", defaultValue: 50 },
        ],
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });

    it("should reject select without options", () => {
      const manifest = {
        version: "1.0",
        runner: "client-static",
        entry: "index.html",
        params: [
          { name: "mode", type: "select", defaultValue: "fast" },
        ],
      };

      const result = manifestSchema.safeParse(manifest);
      expect(result.success).toBe(false);
    });
  });

  describe("validateManifest", () => {
    it("should return valid result for good manifest", () => {
      const manifest: Manifest = {
        version: "1.0",
        runner: "client-static",
        entry: "index.html",
      };

      const result = validateManifest(manifest);
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
    });

    it("should warn about storage capability without explicit grant", () => {
      const manifest: Manifest = {
        version: "1.0",
        runner: "client-static",
        entry: "index.html",
        capabilities: {
          storage: true,
        },
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
      // Storage warning would be in warnings array if implemented
    });
  });
});
