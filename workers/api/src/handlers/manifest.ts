import { ERROR_CAPSULE_ACCESS_BLOCKED } from "@vibecodr/shared";
import { validateManifest, type Manifest } from "@vibecodr/shared/manifest";
import type { Env, Handler } from "../types";
import { requireCapsuleManifest } from "../capsule-manifest";
import { getCapsuleKey } from "../storage/r2";
import { buildBundleCsp, normalizeBundleNetworkMode } from "../security/bundleCsp";
import { guessContentType } from "../runtime/mime";
import { json } from "../lib/responses";
import { resolveCapsuleAccess, type CapsuleAccessResult } from "../capsule-access";

type CapsuleRow = {
  id: string;
  owner_id: string;
  manifest_json: string;
  hash: string;
  quarantined?: number | null;
  quarantine_reason?: string | null;
  quarantined_at?: number | null;
};

type ArtifactAccessRow = {
  id: string;
  status: string;
  policy_status: string;
  visibility: string;
};

type PostAccessRow = {
  author_id: string;
  visibility: string;
  quarantined: number | null;
};

function capsuleUnavailable(reason: string): Response {
  console.warn(`${ERROR_CAPSULE_ACCESS_BLOCKED} capsule access blocked`, { reason });
  return json({ error: "Capsule not available", code: ERROR_CAPSULE_ACCESS_BLOCKED }, 404);
}

async function authorizeCapsuleRequest(
  req: Request,
  env: Env,
  capsuleId: string
): Promise<
  | Response
  | {
      capsule: CapsuleRow;
      viewerIsOwner: boolean;
      viewerIsMod: boolean;
      moderation: CapsuleAccessResult["moderation"];
    }
> {
  const access = await resolveCapsuleAccess(req, env, capsuleId);
  if (access instanceof Response) {
    return access;
  }

  const { capsule, moderation, viewerId, viewerIsOwner, viewerIsMod } = access;

  const artifact = (await env.DB.prepare(
    "SELECT id, status, policy_status, visibility FROM artifacts WHERE capsule_id = ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(capsuleId)
    .first()) as ArtifactAccessRow | null;

  if (artifact) {
    if (artifact.status !== "active" || artifact.policy_status !== "active") {
      return capsuleUnavailable("artifact_policy_blocked");
    }

    if (artifact.visibility === "private" && !viewerIsOwner && !viewerIsMod) {
      return capsuleUnavailable("artifact_private_blocked");
    }
  }

  const postResults = await env.DB.prepare(
    "SELECT author_id, visibility, quarantined FROM posts WHERE capsule_id = ? ORDER BY created_at DESC LIMIT 25"
  )
    .bind(capsuleId)
    .all();

  const posts = (postResults.results || []) as PostAccessRow[];

  const hasVisiblePost = posts.some((row) => {
    const quarantined = (row.quarantined ?? 0) === 1;
    if (quarantined) {
      return viewerIsMod;
    }

    if (row.visibility === "public") {
      return true;
    }

    if (!viewerId) {
      return false;
    }

    return viewerIsOwner || viewerIsMod || row.author_id === viewerId;
  });

  if (!hasVisiblePost) {
    if (posts.length === 0) {
      if (!viewerIsOwner && !viewerIsMod) {
        return capsuleUnavailable("no_visible_post");
      }
    } else if (!viewerIsMod) {
      return capsuleUnavailable("no_visible_post");
    }
  }

  return { capsule, viewerIsOwner, viewerIsMod, moderation };
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
export const getManifest: Handler = async (req, env, _ctx, params) => {
  const capsuleId = params.p1;

  try {
    const access = await authorizeCapsuleRequest(req, env, capsuleId);
    if (access instanceof Response) {
      return access;
    }

    const contentHash = access.capsule.hash as string;

    // Try to get manifest from R2 using content hash (fast path)
    const manifestKey = getCapsuleKey(contentHash, "manifest.json");
    const object = await env.R2.get(manifestKey);

    if (object) {
      const manifest = await object.json<Manifest>();
      return json({ manifest, moderation: access.moderation });
    }

    // Fallback to manifest stored in D1
    const manifest = requireCapsuleManifest(access.capsule.manifest_json, {
      source: "manifestFallback",
      capsuleId,
    });
    return json({ manifest, moderation: access.moderation });
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
export const getCapsuleBundle: Handler = async (req, env, _ctx, params) => {
  const capsuleId = params.p1;

  try {
    const access = await authorizeCapsuleRequest(req, env, capsuleId);
    if (access instanceof Response) {
      return access;
    }

    const contentHash = access.capsule.hash as string;

    // Get manifest first to know the entry point
    const manifestKey = getCapsuleKey(contentHash, "manifest.json");
    const manifestObj = await env.R2.get(manifestKey);

    let manifest: Manifest;
    if (manifestObj) {
      manifest = await manifestObj.json<Manifest>();
    } else {
      manifest = requireCapsuleManifest(access.capsule.manifest_json, {
        source: "bundleFallback",
        capsuleId,
      });
    }

    // Get the entry file using the content hash prefix
    const entryKey = getCapsuleKey(contentHash, manifest.entry);
    const entryObj = await env.R2.get(entryKey);

    if (!entryObj) {
      return json({ error: "Entry file not found" }, 404);
    }

    const contentType = guessContentType(manifest.entry);
    const bundleNetworkMode = normalizeBundleNetworkMode(env.CAPSULE_BUNDLE_NETWORK_MODE);
    const cspHeader = buildBundleCsp(bundleNetworkMode);

    return new Response(entryObj.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Capsule-Runner": manifest.runner,
        "X-Vibecodr-Bundle-Contract": "capsule-debug",
        "Content-Security-Policy": cspHeader,
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
