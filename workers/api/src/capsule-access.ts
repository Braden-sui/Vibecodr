import { verifyAuth, isModeratorOrAdmin } from "./auth";
import { json } from "./lib/responses";
import type { Env } from "./types";

type CapsuleRow = {
  id: string;
  owner_id: string;
  manifest_json: string;
  hash: string;
  quarantined?: number | null;
  quarantine_reason?: string | null;
  quarantined_at?: number | null;
  created_at?: number | null;
};

export type CapsuleAccessResult = {
  capsule: CapsuleRow;
  moderation: {
    state: "allow" | "quarantine";
    quarantined: boolean;
    quarantineReason: string | null;
    quarantinedAt: number | null;
  };
  viewerId: string | null;
  viewerIsOwner: boolean;
  viewerIsMod: boolean;
};

export const ERROR_CAPSULE_UNDER_REVIEW = "E-VIBECODR-0509";

// WHY: Quarantined capsules must stay accessible only to owners and moderators while hidden elsewhere.
export async function resolveCapsuleAccess(
  req: Request,
  env: Env,
  capsuleId: string
): Promise<Response | CapsuleAccessResult> {
  const capsule = (await env.DB.prepare(
    "SELECT id, owner_id, manifest_json, hash, quarantined, quarantine_reason, quarantined_at, created_at FROM capsules WHERE id = ? LIMIT 1"
  )
    .bind(capsuleId)
    .first()) as CapsuleRow | null;

  if (!capsule) {
    return json({ error: "Capsule not found" }, 404);
  }

  const authedUser = await verifyAuth(req, env);
  const viewerId = authedUser?.userId ?? null;
  const viewerIsOwner = viewerId === capsule.owner_id;
  const viewerIsMod = !!(authedUser && isModeratorOrAdmin(authedUser));

  const quarantined = Number(capsule.quarantined ?? 0) === 1;
  const quarantineReasonRaw = capsule.quarantine_reason;
  const moderation: CapsuleAccessResult["moderation"] = {
    state: (quarantined ? "quarantine" : "allow") as CapsuleAccessResult["moderation"]["state"],
    quarantined,
    quarantineReason:
      typeof quarantineReasonRaw === "string"
        ? quarantineReasonRaw
        : typeof quarantineReasonRaw === "number"
          ? String(quarantineReasonRaw)
          : null,
    quarantinedAt:
      typeof capsule.quarantined_at === "number"
        ? capsule.quarantined_at
        : capsule.quarantined_at
          ? Number(capsule.quarantined_at)
          : null,
  };

  if (quarantined && !viewerIsOwner && !viewerIsMod) {
    console.warn(`${ERROR_CAPSULE_UNDER_REVIEW} capsule access blocked`, {
      capsuleId,
      viewerId,
    });
    return json({ error: "Capsule not available", code: ERROR_CAPSULE_UNDER_REVIEW }, 404);
  }

  return { capsule, moderation, viewerId, viewerIsOwner, viewerIsMod };
}
