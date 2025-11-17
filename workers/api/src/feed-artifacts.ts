export type CapsuleArtifactRow = {
  capsule_id?: string | null;
  id?: string | null;
  created_at?: number | string | null;
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
