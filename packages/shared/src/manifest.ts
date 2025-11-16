import { z } from "zod";
import { ERROR_MANIFEST_INVALID, ERROR_MANIFEST_TOO_LARGE, type ErrorCode } from "./errors";

/**
 * Manifest Schema for Vibecodr Capsules
 * Based on research-sandbox-and-runner.md
 * Defines how capsules are structured, what capabilities they have, and how they run
 */

// Param types that can be exposed in the Player UI
export const paramTypeSchema = z.enum(["slider", "toggle", "select", "text", "color", "number"]);

// Individual param definition
export const paramSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Must be valid identifier"),
    type: paramTypeSchema,
    label: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]),
    // For slider/number
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    // For select
    options: z.array(z.string()).min(1).optional(),
    // For text
    maxLength: z.number().min(1).max(1000).optional(),
    placeholder: z.string().max(100).optional(),
  })
  .superRefine((param, ctx) => {
    if (param.type === "slider" && (param.min === undefined || param.max === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Slider params must include min and max values",
        path: ["min"],
      });
    }

    if (param.type === "select" && (!param.options || param.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select params must provide options",
        path: ["options"],
      });
    }
  });

const hostStringSchema = z.string().refine(
  (host) => {
    try {
      new URL(`https://${host}`);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid host format" }
);

// Runner types
export const runnerTypeSchema = z.enum(["client-static", "webcontainer", "worker-edge"]);

const edgeBindingTypeSchema = z.enum(["d1", "r2", "kv", "queue", "do", "env"]);

const edgeBindingSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_]+$/, "Use screaming snake case for binding names"),
  type: edgeBindingTypeSchema,
  identifier: z.string().min(1).max(100),
});

const edgeWorkerSchema = z.object({
  entry: z.string().min(1).max(200),
  bindings: z.array(edgeBindingSchema).max(10).optional(),
  outboundHosts: z.array(hostStringSchema).max(5).optional(),
  cpuMs: z.number().int().min(1).max(100).optional(),
  memoryMb: z.number().int().min(128).max(512).optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
});

const liveFeatureSchema = z.enum(["pointer-sync", "param-timeline", "chat", "recording"]);

const liveSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  waitlistOnly: z.boolean().default(true),
  requiresPlan: z.enum(["creator", "pro", "team"]).optional(),
  minutesBudget: z.number().int().min(5).max(600).optional(),
  features: z.array(liveFeatureSchema).min(1).max(4).optional(),
});

// Capability model - what the capsule is allowed to do
export const capabilitiesSchema = z.object({
  // Network access - allowlist of hosts
  net: z.array(hostStringSchema).max(10, "Maximum 10 allowed hosts").optional(),
  // Storage access - IndexedDB
  storage: z.boolean().optional().default(false),
  // Web Workers
  workers: z.boolean().optional().default(false),
  concurrency: z
    .object({
      previews: z.number().int().min(1).max(4).optional(),
      player: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
});

// Main manifest schema
export const manifestSchema = z.object({
  version: z.literal("1.0"),
  runner: runnerTypeSchema,
  entry: z.string().min(1).max(200), // Main entry file (e.g., "index.html", "main.js")
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  author: z
    .object({
      name: z.string().max(100).optional(),
      url: z.string().url().optional(),
    })
    .optional(),
  license: z.string().max(50).optional(), // SPDX identifier
  params: z.array(paramSchema).max(20, "Maximum 20 parameters").optional(),
  capabilities: capabilitiesSchema.optional(),
  live: liveSettingsSchema.optional(),
  edgeWorker: edgeWorkerSchema.optional(),
  // Asset list with sizes for validation
  assets: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        size: z.number().int().positive(),
        hash: z.string().optional(), // SHA-256 hash
      })
    )
    .optional(),
  // Total bundle size in bytes
  bundleSize: z.number().int().positive().optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestParam = z.infer<typeof paramSchema>;
export type ManifestCapabilities = z.infer<typeof capabilitiesSchema>;
export type RunnerType = z.infer<typeof runnerTypeSchema>;

/**
 * Validation result with detailed errors
 */
export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
    code?: string;
    errorCode?: ErrorCode;
  }>;
  warnings?: Array<{
    path: string;
    message: string;
  }>;
}

/**
 * Validate a manifest and return detailed errors
 */
export function validateManifest(data: unknown): ValidationResult {
  try {
    const result = manifestSchema.safeParse(data);

    if (!result.success) {
      return {
        valid: false,
        errors: result.error.errors.map((err) => ({
          path: err.path.join("."),
          message: err.message,
          code: err.code,
          errorCode: ERROR_MANIFEST_INVALID,
        })),
      };
    }

    // Additional validation and warnings
    const manifest = result.data;
    const warnings: ValidationResult["warnings"] = [];
    const errors: ValidationResult["errors"] = [];

    // Check for missing license
    if (!manifest.license) {
      warnings.push({
        path: "license",
        message: "No license specified. Consider adding an SPDX identifier.",
      });
    }

    // Check bundle size limits (based on mvp-plan.md)
    const MAX_BUNDLE_SIZE = 25 * 1024 * 1024; // 25 MB for free tier
    if (manifest.bundleSize && manifest.bundleSize > MAX_BUNDLE_SIZE) {
      errors.push({
        path: "bundleSize",
        message: `Bundle size ${(manifest.bundleSize / 1024 / 1024).toFixed(2)} MB exceeds maximum of 25 MB for free/creator tiers`,
        errorCode: ERROR_MANIFEST_TOO_LARGE,
      });
    }

    if (manifest.runner === "worker-edge" && !manifest.edgeWorker) {
      errors.push({
        path: "edgeWorker",
        message: "Worker-edge capsules must define edgeWorker configuration",
      });
    }

    if (manifest.live?.enabled && manifest.live.waitlistOnly && !manifest.live.requiresPlan) {
      warnings.push({
        path: "live.requiresPlan",
        message: "Specify a required plan when live sessions are waitlist-only.",
      });
    }

    if (manifest.live?.enabled && manifest.live.minutesBudget && manifest.live.minutesBudget > 120) {
      warnings.push({
        path: "live.minutesBudget",
        message: "Live sessions longer than 120 minutes may exceed included plan minutes.",
      });
    }

    if (manifest.edgeWorker?.bindings && manifest.edgeWorker.bindings.length > 5) {
      warnings.push({
        path: "edgeWorker.bindings",
        message: "Consider reducing bindings; keep worker-edge capsules lean for fast deploys.",
      });
    }

    // Check params have valid defaults
    if (manifest.params) {
      for (const param of manifest.params) {
        if (param.type === "slider" || param.type === "number") {
          const val = param.default as number;
          if (param.min !== undefined && val < param.min) {
            warnings.push({
              path: `params.${param.name}.default`,
              message: `Default value ${val} is below minimum ${param.min}`,
            });
          }
          if (param.max !== undefined && val > param.max) {
            warnings.push({
              path: `params.${param.name}.default`,
              message: `Default value ${val} is above maximum ${param.max}`,
            });
          }
        }
        if (param.type === "select") {
          if (!param.options || param.options.length === 0) {
            return {
              valid: false,
              errors: [
                {
                  path: `params.${param.name}.options`,
                  message: "Select param must have options",
                },
              ],
            };
          }
          if (!param.options.includes(param.default as string)) {
            warnings.push({
              path: `params.${param.name}.default`,
              message: "Default value is not in options list",
            });
          }
        }
      }
    }

    // Check for common security issues
    if (manifest.capabilities?.net && manifest.capabilities.net.length > 0) {
      errors.push({
        path: "capabilities.net",
        message:
          "Network access is currently disabled. Remove allowed hosts and retry once premium VM tiers launch.",
        errorCode: ERROR_MANIFEST_INVALID,
      });
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          path: "manifest",
          message: error instanceof Error ? error.message : "Unknown validation error",
        },
      ],
    };
  }
}

/**
 * Create a default manifest template
 */
export function createDefaultManifest(runner: RunnerType = "client-static"): Manifest {
  return {
    version: "1.0",
    runner,
    entry: "index.html",
    title: "My Capsule",
    description: "A runnable micro-app",
    params: [],
    capabilities: {
      storage: false,
      workers: false,
    },
  };
}

/**
 * Merge param updates into manifest safely
 */
export function updateManifestParams(
  manifest: Manifest,
  params: ManifestParam[]
): Manifest {
  return {
    ...manifest,
    params: params.map((p) => ({
      ...p,
      // Ensure name is valid
      name: p.name.replace(/[^a-zA-Z0-9_]/g, "_"),
    })),
  };
}
