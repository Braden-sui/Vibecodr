import { validateManifest, type Manifest } from "@vibecodr/shared/manifest";
import type { Env } from "../index";
import { getCapsuleKey } from "../storage/r2";

type Handler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>
) => Promise<Response>;

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/**
 * POST /manifest/validate
 * Validates a manifest JSON and returns detailed errors/warnings
 * Based on research-sandbox-and-runner.md capability model
 */
export const validateManifestHandler: Handler = async (req) => {
  try {
    const body = await req.json();

    const result = validateManifest(body);

    if (!result.valid) {
      return json(
        {
          valid: false,
          errors: result.errors,
          warnings: result.warnings,
        },
        400
      );
    }

    return json({
      valid: true,
      warnings: result.warnings,
      manifest: body as Manifest,
    });
  } catch (error) {
    return json(
      {
        valid: false,
        errors: [
          {
            path: "body",
            message: "Invalid JSON or request body",
          },
        ],
      },
      400
    );
  }
};

/**
 * GET /capsules/:id/manifest
 * Retrieves the manifest for a published capsule
 */
export const getManifest: Handler = async (_req, env, _ctx, params) => {
  const capsuleId = params.p1;

  try {
    // Look up capsule to get content hash and stored manifest
    const { results } = await env.DB.prepare(
      "SELECT manifest_json, hash FROM capsules WHERE id = ? LIMIT 1"
    )
      .bind(capsuleId)
      .all();

    if (!results || results.length === 0) {
      return json({ error: "Capsule not found" }, 404);
    }

    const row = results[0];
    const contentHash = row.hash as string;

    // Try to get manifest from R2 using content hash (fast path)
    const manifestKey = getCapsuleKey(contentHash, "manifest.json");
    const object = await env.R2.get(manifestKey);

    if (object) {
      const manifest = await object.json<Manifest>();
      return json({ manifest });
    }

    // Fallback to manifest stored in D1
    const manifest = JSON.parse(row.manifest_json as string);
    return json({ manifest });
  } catch (error) {
    return json(
      {
        error: "Failed to retrieve manifest",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
};

/**
 * GET /capsules/:id/bundle
 * Retrieves the complete capsule bundle from R2
 * Returns the main entry file with proper headers
 */
export const getCapsuleBundle: Handler = async (_req, env, _ctx, params) => {
  const capsuleId = params.p1;

  try {
    // Look up capsule to get content hash and stored manifest
    const { results } = await env.DB.prepare(
      "SELECT manifest_json, hash FROM capsules WHERE id = ? LIMIT 1"
    )
      .bind(capsuleId)
      .all();

    if (!results || results.length === 0) {
      return json({ error: "Capsule not found" }, 404);
    }

    const row = results[0];
    const contentHash = row.hash as string;

    // Get manifest first to know the entry point
    const manifestKey = getCapsuleKey(contentHash, "manifest.json");
    const manifestObj = await env.R2.get(manifestKey);

    let manifest: Manifest;
    if (manifestObj) {
      manifest = await manifestObj.json<Manifest>();
    } else {
      manifest = JSON.parse(row.manifest_json as string) as Manifest;
    }

    // Get the entry file using the content hash prefix
    const entryKey = getCapsuleKey(contentHash, manifest.entry);
    const entryObj = await env.R2.get(entryKey);

    if (!entryObj) {
      return json({ error: "Entry file not found" }, 404);
    }

    // Determine content type
    const contentType = getContentType(manifest.entry);

    return new Response(entryObj.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Capsule-Runner": manifest.runner,
        // Strict CSP for safety
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
      },
    });
  } catch (error) {
    return json(
      {
        error: "Failed to retrieve bundle",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
};

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html",
    js: "application/javascript",
    css: "text/css",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    wasm: "application/wasm",
  };
  return types[ext || ""] || "application/octet-stream";
}
