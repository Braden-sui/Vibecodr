import type { Env } from "./index";

export type CapsuleArtifactRow = {
  capsule_id?: string | null;
  id?: string | null;
  created_at?: number | string | null;
};

export type LatestArtifactInfo = {
  artifactId: string;
  createdAt: number;
};

function normalizeTimestamp(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = typeof value === "string" ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildLatestArtifactMap(rows: CapsuleArtifactRow[]): Map<string, string> {
  const latestByCapsule = new Map<string, { artifactId: string; createdAt: number }>();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const capsuleId = typeof row.capsule_id === "string" ? row.capsule_id : undefined;
    const artifactId = typeof row.id === "string" ? row.id : undefined;
    if (!capsuleId || !artifactId) {
      continue;
    }

    const createdAt = normalizeTimestamp(row.created_at);
    const current = latestByCapsule.get(capsuleId);
    if (!current || createdAt > current.createdAt) {
      latestByCapsule.set(capsuleId, { artifactId, createdAt });
    }
  }

  const result = new Map<string, string>();
  for (const [capsuleId, entry] of latestByCapsule.entries()) {
    result.set(capsuleId, entry.artifactId);
  }

  return result;
}

type ArtifactEnv = Pick<Env, "DB" | "RUNTIME_MANIFEST_KV">;

const LATEST_ARTIFACT_CACHE_PREFIX = "feed/latest-artifact/v1/";
const LATEST_ARTIFACT_CACHE_TTL_SECONDS = 300;

function cacheKeyForCapsule(capsuleId: string): string {
  return `${LATEST_ARTIFACT_CACHE_PREFIX}${capsuleId}`;
}

function parseCacheValue(raw: string | null): LatestArtifactInfo | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { artifactId?: string; createdAt?: number | string | null };
    if (!parsed || typeof parsed.artifactId !== "string") return null;
    return {
      artifactId: parsed.artifactId,
      createdAt: normalizeTimestamp(parsed.createdAt),
    };
  } catch {
    return null;
  }
}

async function readLatestArtifactCache(
  kv: KVNamespace,
  capsuleIds: string[]
): Promise<{ cached: Map<string, LatestArtifactInfo>; missing: string[] }> {
  const cached = new Map<string, LatestArtifactInfo>();
  const missing: string[] = [];

  await Promise.all(
    capsuleIds.map(async (capsuleId) => {
      try {
        const cacheValue = await kv.get(cacheKeyForCapsule(capsuleId));
        const parsed = parseCacheValue(cacheValue);
        if (parsed) {
          cached.set(capsuleId, parsed);
        } else {
          missing.push(capsuleId);
        }
      } catch (err) {
        console.error("E-VIBECODR-1301 latest artifact cache read failed", {
          capsuleId,
          error: err instanceof Error ? err.message : String(err),
        });
        missing.push(capsuleId);
      }
    })
  );

  return { cached, missing };
}

async function writeLatestArtifactCache(
  kv: KVNamespace,
  entries: Map<string, LatestArtifactInfo>
): Promise<void> {
  await Promise.all(
    Array.from(entries.entries()).map(async ([capsuleId, info]) => {
      try {
        const payload = JSON.stringify(info);
        await kv.put(cacheKeyForCapsule(capsuleId), payload, {
          expirationTtl: LATEST_ARTIFACT_CACHE_TTL_SECONDS,
        });
      } catch (err) {
        console.error("E-VIBECODR-1302 latest artifact cache write failed", {
          capsuleId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );
}

async function fetchLatestArtifactsFromDb(env: ArtifactEnv, capsuleIds: string[]): Promise<Map<string, LatestArtifactInfo>> {
  if (capsuleIds.length === 0) return new Map();

  const placeholders = capsuleIds.map(() => "?").join(",");
  const query = `
    SELECT a.capsule_id, a.id, a.created_at
    FROM artifacts a
    INNER JOIN (
      SELECT capsule_id, MAX(created_at) as max_created_at
      FROM artifacts
      WHERE capsule_id IN (${placeholders})
        AND status = 'active'
        AND policy_status = 'active'
        AND visibility IN ('public','unlisted')
      GROUP BY capsule_id
    ) latest
      ON latest.capsule_id = a.capsule_id
     AND latest.max_created_at = a.created_at
  `;

  const { results } = await env.DB.prepare(query).bind(...capsuleIds).all();
  const latest = new Map<string, LatestArtifactInfo>();
  for (const row of results || []) {
    const capsuleId = (row as any).capsule_id;
    const artifactId = (row as any).id;
    if (!capsuleId || !artifactId) continue;
    latest.set(String(capsuleId), {
      artifactId: String(artifactId),
      createdAt: normalizeTimestamp((row as any).created_at),
    });
  }
  return latest;
}

async function fetchLatestActiveTimestamps(env: ArtifactEnv, capsuleIds: string[]): Promise<Map<string, number>> {
  if (capsuleIds.length === 0) return new Map();

  const placeholders = capsuleIds.map(() => "?").join(",");
  const query = `
    SELECT capsule_id, MAX(created_at) as max_created_at
    FROM artifacts
    WHERE capsule_id IN (${placeholders})
      AND status = 'active'
      AND policy_status = 'active'
      AND visibility IN ('public','unlisted')
    GROUP BY capsule_id
  `;

  const { results } = await env.DB.prepare(query).bind(...capsuleIds).all();
  const latest = new Map<string, number>();
  for (const row of results || []) {
    const capsuleId = (row as any).capsule_id;
    if (!capsuleId) continue;
    latest.set(String(capsuleId), normalizeTimestamp((row as any).max_created_at));
  }
  return latest;
}

// WHY: Avoid re-scanning artifacts on every feed fetch; cache the latest active artifact per capsule with bounded TTL.
// INVARIANT: Only active + policy_active artifacts that are public or unlisted are returned; cache TTL caps staleness.
export async function getLatestArtifactsWithCache(env: ArtifactEnv, capsuleIds: string[]): Promise<Map<string, LatestArtifactInfo>> {
  if (capsuleIds.length === 0) return new Map();

  const distinctCapsuleIds = Array.from(new Set(capsuleIds));
  const kv = env.RUNTIME_MANIFEST_KV;

  let cached = new Map<string, LatestArtifactInfo>();
  let missing = distinctCapsuleIds;

  if (kv) {
    const cacheResult = await readLatestArtifactCache(kv, distinctCapsuleIds);
    cached = cacheResult.cached;
    missing = cacheResult.missing;
  }

  // If we have cached entries, verify whether a newer active artifact exists; refresh those capsules.
  const capsulesToValidate = Array.from(cached.keys());
  if (capsulesToValidate.length > 0) {
    const latestTimestamps = await fetchLatestActiveTimestamps(env, capsulesToValidate);
    for (const capsuleId of capsulesToValidate) {
      const cachedInfo = cached.get(capsuleId);
      const latestTs = latestTimestamps.get(capsuleId);
      if (cachedInfo && typeof latestTs === "number" && latestTs > cachedInfo.createdAt) {
        missing.push(capsuleId);
      }
    }
  }

  if (missing.length > 0) {
    const fetched = await fetchLatestArtifactsFromDb(env, Array.from(new Set(missing)));
    fetched.forEach((info, capsuleId) => cached.set(capsuleId, info));
    if (kv && fetched.size > 0) {
      await writeLatestArtifactCache(kv, fetched);
    }
  }

  return cached;
}

export async function invalidateLatestArtifactCache(env: ArtifactEnv, capsuleId: string): Promise<void> {
  const kv = env.RUNTIME_MANIFEST_KV;
  if (!kv) return;
  try {
    await kv.delete(cacheKeyForCapsule(capsuleId));
  } catch (err) {
    console.error("E-VIBECODR-1303 latest artifact cache invalidation failed", {
      capsuleId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
