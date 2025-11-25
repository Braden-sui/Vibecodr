import { requireAdmin } from "../auth";
import { json } from "../lib/responses";
import type { Env, Handler } from "../types";
import { getCapsuleKey } from "../storage/r2";
import { safeParseCapsuleManifest } from "../capsule-manifest";
import type { Manifest } from "@vibecodr/shared/manifest";
import type { RuntimeManifest } from "../runtime/runtimeManifest";
import {
  ERROR_INSPECTOR_COMPILE_STATE_FAILED,
  ERROR_INSPECTOR_MANIFEST_LOAD_FAILED,
} from "@vibecodr/shared";

type CapsuleRow = {
  id: string;
  owner_id: string;
  manifest_json: string;
  hash: string;
  quarantined?: number | null;
  quarantine_reason?: string | null;
  created_at?: number | null;
};

type ArtifactRow = {
  id: string;
  owner_id: string;
  capsule_id: string;
  type: string;
  runtime_version?: string | null;
  status?: string | null;
  policy_status?: string | null;
  visibility?: string | null;
  safety_tier?: string | null;
  risk_score?: number | null;
  created_at?: number | null;
};

type ArtifactManifestRow = {
  manifest_json: string;
  version: number;
  runtime_version?: string | null;
};

type RuntimeEventRow = {
  id: string;
  event_name: string;
  capsule_id?: string | null;
  artifact_id?: string | null;
  runtime_type?: string | null;
  runtime_version?: string | null;
  code?: string | null;
  message?: string | null;
  properties?: string | null;
  created_at?: number | null;
};

type CapsuleManifestLoad = {
  manifest: Manifest | null;
  source: "r2" | "db" | null;
  error?: string | null;
};

type RuntimeManifestLoad = {
  manifest: RuntimeManifest | null;
  version: number | null;
  runtimeVersion: string | null;
  source: "kv" | "db" | null;
  error?: string | null;
};

type CompileState = {
  lastCompileRequest?: unknown;
  lastCompileResult?: unknown;
  error?: string;
  code?: string;
};

const RUNTIME_EVENT_LIMIT = 40;
const INTERESTING_EVENTS = new Set([
  "runtime_policy_violation",
  "runtime_budget_exceeded",
  "runtime_killed",
  "runtime_error",
  "runtime_loader_error",
  "runtime_manifest_error",
  "runtime_frame_error",
  "runtime_security_warning",
  "runtime_events_capped",
]);

async function loadCapsuleManifest(env: Env, capsule: CapsuleRow): Promise<CapsuleManifestLoad> {
  let manifest: Manifest | null = null;
  let source: CapsuleManifestLoad["source"] = null;
  let error: string | null = null;

  if (capsule.hash) {
    try {
      const manifestKey = getCapsuleKey(capsule.hash, "manifest.json");
      const object = await env.R2.get(manifestKey);
      if (object) {
        const parsed = await object.json<Manifest>();
        const validated = safeParseCapsuleManifest(parsed, { source: "inspector", capsuleId: capsule.id });
        if (validated) {
          manifest = validated;
          source = "r2";
        }
      }
    } catch (err) {
      error =
        err instanceof Error
          ? err.message
          : "Failed to read manifest from R2";
    }
  }

  if (!manifest) {
    const validated = safeParseCapsuleManifest(capsule.manifest_json, {
      source: "inspector-db",
      capsuleId: capsule.id,
    });
    if (validated) {
      manifest = validated;
      source = "db";
    } else if (!error) {
      error = `${ERROR_INSPECTOR_MANIFEST_LOAD_FAILED} capsule manifest invalid`;
    }
  }

  return { manifest, source, error };
}

async function loadRuntimeManifest(env: Env, artifactId: string): Promise<RuntimeManifestLoad> {
  let manifestJson: string | null = null;
  let source: RuntimeManifestLoad["source"] = null;
  let manifestRow: ArtifactManifestRow | null = null;
  let error: string | null = null;

  const kvKey = `artifacts/${artifactId}/v1/runtime-manifest.json`;
  if (env.RUNTIME_MANIFEST_KV) {
    try {
      const kvValue = await env.RUNTIME_MANIFEST_KV.get(kvKey);
      if (typeof kvValue === "string" && kvValue.length > 0) {
        manifestJson = kvValue;
        source = "kv";
      }
    } catch (err) {
      error =
        err instanceof Error
          ? err.message
          : "Runtime manifest KV read failed";
    }
  }

  if (!manifestJson) {
    manifestRow = (await env.DB.prepare(
      "SELECT manifest_json, version, runtime_version FROM artifact_manifests WHERE artifact_id = ? ORDER BY version DESC LIMIT 1"
    )
      .bind(artifactId)
      .first()) as ArtifactManifestRow | null;
    if (manifestRow?.manifest_json) {
      manifestJson = String(manifestRow.manifest_json);
      source = "db";
    }
  }

  if (!manifestJson) {
    return { manifest: null, version: manifestRow?.version ?? null, runtimeVersion: null, source, error };
  }

  try {
    const parsed = JSON.parse(manifestJson) as RuntimeManifest;
    const runtimeVersion =
      manifestRow?.runtime_version || parsed.runtime?.version || null;
    return {
      manifest: parsed,
      version: manifestRow?.version ?? null,
      runtimeVersion,
      source,
      error: null,
    };
  } catch (err) {
    return {
      manifest: null,
      version: manifestRow?.version ?? null,
      runtimeVersion: manifestRow?.runtime_version || null,
      source,
      error: `${ERROR_INSPECTOR_MANIFEST_LOAD_FAILED} runtime manifest parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

async function loadRuntimeEvents(
  env: Env,
  filter: { capsuleId?: string | null; artifactId?: string | null }
): Promise<
  Array<{
    id: string;
    eventName: string;
    capsuleId: string | null;
    artifactId: string | null;
    runtimeType: string | null;
    runtimeVersion: string | null;
    code: string | null;
    message: string | null;
    properties: Record<string, unknown> | null;
    createdAt: number | null;
  }>
> {
  const conditions: string[] = [];
  const bindArgs: Array<string | number> = [];

  if (filter.artifactId) {
    conditions.push("artifact_id = ?");
    bindArgs.push(filter.artifactId);
  } else if (filter.capsuleId) {
    conditions.push("capsule_id = ?");
    bindArgs.push(filter.capsuleId);
  }

  const placeholders = Array.from(INTERESTING_EVENTS)
    .map(() => "?")
    .join(", ");
  conditions.push(`event_name IN (${placeholders})`);
  for (const event of INTERESTING_EVENTS) {
    bindArgs.push(event);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const results = (await env.DB.prepare(
    `
    SELECT id, event_name, capsule_id, artifact_id, runtime_type, runtime_version, code, message, properties, created_at
    FROM runtime_events
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ?
    `
  )
    .bind(...bindArgs, RUNTIME_EVENT_LIMIT)
    .all()).results as RuntimeEventRow[] | undefined;

  if (!results) {
    return [];
  }

  return results.map((row) => {
    let properties: Record<string, unknown> | null = null;
    if (row.properties) {
      try {
        properties = JSON.parse(row.properties) as Record<string, unknown>;
      } catch {
        properties = null;
      }
    }

    const createdAtMs =
      typeof row.created_at === "number" && Number.isFinite(row.created_at)
        ? row.created_at * 1000
        : null;

    return {
      id: String(row.id),
      eventName: row.event_name,
      capsuleId: row.capsule_id ?? null,
      artifactId: row.artifact_id ?? null,
      runtimeType: row.runtime_type ?? null,
      runtimeVersion: row.runtime_version ?? null,
      code: row.code ?? null,
      message: row.message ?? null,
      properties,
      createdAt: createdAtMs,
    };
  });
}

async function fetchCompileState(env: Env, artifactId: string): Promise<CompileState> {
  try {
    const ns = env.ARTIFACT_COMPILER_DURABLE;
    const id = ns.idFromName(artifactId);
    const stub = ns.get(id);
    const res = await stub.fetch("https://internal/artifact-compiler/inspect");

    if (!res.ok) {
      return {
        error: `Compile state not available (${res.status})`,
        code: ERROR_INSPECTOR_COMPILE_STATE_FAILED,
      };
    }

    const payload = (await res.json()) as CompileState & { ok?: boolean; code?: string };
    return {
      lastCompileRequest: payload.lastCompileRequest,
      lastCompileResult: payload.lastCompileResult,
      error: payload.ok === false ? payload.error : undefined,
      code: payload.code,
    };
  } catch (err) {
    return {
      error: `${ERROR_INSPECTOR_COMPILE_STATE_FAILED} durable object fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      code: ERROR_INSPECTOR_COMPILE_STATE_FAILED,
    };
  }
}

function normalizeCapsuleRow(row: CapsuleRow, manifestLoad: CapsuleManifestLoad | null) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    quarantined: (row.quarantined ?? 0) === 1,
    quarantineReason: row.quarantine_reason ?? null,
    createdAt: row.created_at ?? null,
    manifest: manifestLoad?.manifest ?? null,
    manifestSource: manifestLoad?.source ?? null,
    manifestError: manifestLoad?.error ?? null,
    hash: row.hash,
  };
}

function normalizeArtifactRow(row: ArtifactRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    capsuleId: row.capsule_id,
    type: row.type,
    runtimeVersion: row.runtime_version ?? null,
    status: row.status ?? null,
    policyStatus: row.policy_status ?? null,
    visibility: row.visibility ?? null,
    safetyTier: row.safety_tier ?? null,
    riskScore: row.risk_score ?? null,
    createdAt: row.created_at ?? null,
  };
}

export const inspectArtifact: Handler = requireAdmin(async (req, env, _ctx, params) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const artifactId = params.p1;
  if (!artifactId) {
    return json({ error: "artifactId is required" }, 400);
  }

  const row = (await env.DB.prepare(
    `
    SELECT
      a.id,
      a.owner_id,
      a.capsule_id,
      a.type,
      a.runtime_version,
      a.status,
      a.policy_status,
      a.visibility,
      a.safety_tier,
      a.risk_score,
      a.created_at,
      c.id as capsule_id_alias,
      c.owner_id as capsule_owner_id,
      c.manifest_json as capsule_manifest_json,
      c.hash as capsule_hash,
      c.quarantined as capsule_quarantined,
      c.quarantine_reason as capsule_quarantine_reason,
      c.created_at as capsule_created_at
    FROM artifacts a
    LEFT JOIN capsules c ON c.id = a.capsule_id
    WHERE a.id = ?
    LIMIT 1
    `
  )
    .bind(artifactId)
    .first()) as (ArtifactRow & {
    capsule_id_alias?: string | null;
    capsule_owner_id?: string | null;
    capsule_manifest_json?: string | null;
    capsule_hash?: string | null;
    capsule_quarantined?: number | null;
    capsule_quarantine_reason?: string | null;
    capsule_created_at?: number | null;
  }) | null;

  if (!row) {
    return json({ error: "Artifact not found" }, 404);
  }

  const capsule: CapsuleRow | null = row.capsule_id
    ? {
        id: row.capsule_id_alias || row.capsule_id,
        owner_id: row.capsule_owner_id || "",
        manifest_json: row.capsule_manifest_json || "",
        hash: row.capsule_hash || "",
        quarantined: row.capsule_quarantined ?? 0,
        quarantine_reason: row.capsule_quarantine_reason ?? null,
        created_at: row.capsule_created_at ?? null,
      }
    : null;

  const capsuleManifest = capsule ? await loadCapsuleManifest(env, capsule) : null;
  const runtimeManifest = await loadRuntimeManifest(env, artifactId);
  const events = await loadRuntimeEvents(env, { artifactId, capsuleId: row.capsule_id });
  const compile = await fetchCompileState(env, artifactId);

  return json({
    artifact: normalizeArtifactRow(row),
    capsule: capsule && capsuleManifest ? normalizeCapsuleRow(capsule, capsuleManifest) : null,
    runtimeManifest,
    compile,
    events,
  });
});

export const inspectCapsule: Handler = requireAdmin(async (req, env, _ctx, params) => {
  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const capsuleId = params.p1;
  if (!capsuleId) {
    return json({ error: "capsuleId is required" }, 400);
  }

  const capsuleRow = (await env.DB.prepare(
    `
    SELECT id, owner_id, manifest_json, hash, quarantined, quarantine_reason, created_at
    FROM capsules
    WHERE id = ?
    LIMIT 1
    `
  )
    .bind(capsuleId)
    .first()) as CapsuleRow | null;

  if (!capsuleRow) {
    return json({ error: "Capsule not found" }, 404);
  }

  const latestArtifact = (await env.DB.prepare(
    `
    SELECT id, owner_id, capsule_id, type, runtime_version, status, policy_status, visibility, safety_tier, risk_score, created_at
    FROM artifacts
    WHERE capsule_id = ?
    ORDER BY created_at DESC
    LIMIT 1
    `
  )
    .bind(capsuleId)
    .first()) as ArtifactRow | null;

  const capsuleManifest = await loadCapsuleManifest(env, capsuleRow);
  const runtimeManifest = latestArtifact ? await loadRuntimeManifest(env, latestArtifact.id) : null;
  const compile = latestArtifact ? await fetchCompileState(env, latestArtifact.id) : null;
  const events = await loadRuntimeEvents(env, { capsuleId, artifactId: latestArtifact?.id });

  return json({
    capsule: normalizeCapsuleRow(capsuleRow, capsuleManifest),
    latestArtifact: latestArtifact ? normalizeArtifactRow(latestArtifact) : null,
    runtimeManifest,
    compile,
    events,
  });
});
