const TAG_LIMIT = 24;

// INVARIANT: Returned tag values are lowercase, trimmed, and restricted to letters, numbers, and hyphens.
export function normalizeTag(raw: string): string {
  const normalized = (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, TAG_LIMIT);
  return normalized;
}

export const featuredTags = [
  "ai",
  "visualization",
  "canvas",
  "cli",
  "webcontainer",
  "data",
  "audio",
  "games",
] as const;

// INVARIANT: Returned list preserves the first occurrence order after normalization and drops empties.
export function normalizeTagList(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
