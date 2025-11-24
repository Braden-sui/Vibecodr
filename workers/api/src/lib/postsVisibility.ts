import type { Env } from "../types";

let cachedPostsVisibilityColumn: boolean | null = null;

export async function hasPostVisibilityColumn(env: Env): Promise<boolean> {
  if (cachedPostsVisibilityColumn !== null) {
    return cachedPostsVisibilityColumn;
  }

  try {
    const { results } = await env.DB.prepare(`PRAGMA table_info(posts)`).all();
    const hasCol = Array.isArray(results)
      ? results.some((row: any) => (row?.name ?? "").toLowerCase() === "visibility")
      : false;
    cachedPostsVisibilityColumn = hasCol;
    return hasCol;
  } catch (err) {
    console.error("E-VIBECODR-2201 post visibility column check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    cachedPostsVisibilityColumn = false;
    return false;
  }
}

export function resetPostsVisibilityCache(): void {
  cachedPostsVisibilityColumn = null;
}
