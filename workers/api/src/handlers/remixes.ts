import { hasPostVisibilityColumn } from "../lib/postsVisibility";
import { json } from "../lib/responses";
import type { Env, Handler } from "../types";

const ERROR_REMIX_BAD_REQUEST = "E-VIBECODR-0901";
const ERROR_REMIX_CYCLE_DETECTED = "E-VIBECODR-0902";
const ERROR_REMIX_NOT_FOUND = "E-VIBECODR-0903";
const ERROR_REMIX_TREE_FAILED = "E-VIBECODR-0904";

const MAX_TREE_NODES = 200;
const MAX_PARENT_HOPS = 25;
const MAX_CHILD_BATCH = 25;

type RemixRow = {
  parent_capsule_id?: string | null;
  child_capsule_id?: string | null;
  created_at?: number | null;
};

type PostRow = {
  post_id?: string | null;
  title?: string | null;
  description?: string | null;
  capsule_id?: string | null;
  created_at?: number | null;
  author_id?: string | null;
  author_handle?: string | null;
  author_name?: string | null;
  profile_display_name?: string | null;
};

type NodeState = {
  capsuleId: string;
  parentId: string | null;
  children: Set<string>;
  depth: number;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const getRemixTree: Handler = async (req, env, _ctx, params) => {
  const capsuleId = params.p1;
  if (!capsuleId || !capsuleId.trim()) {
    return json({ error: "capsuleId is required", code: ERROR_REMIX_BAD_REQUEST }, 400);
  }
  const targetCapsuleId = capsuleId.trim();

  try {
    const capsuleExists = await env.DB.prepare("SELECT id FROM capsules WHERE id = ?")
      .bind(targetCapsuleId)
      .first();
    if (!capsuleExists) {
      return json({ error: "Capsule not found", code: ERROR_REMIX_NOT_FOUND }, 404);
    }

    const ancestrySeen = new Set<string>();
    let rootCapsuleId = targetCapsuleId;
    let directParentId: string | null = null;
    let ancestryTruncated = false;

    for (let i = 0; i < MAX_PARENT_HOPS; i++) {
      ancestrySeen.add(rootCapsuleId);
      const parentRow = await env.DB.prepare(
        "SELECT parent_capsule_id FROM remixes WHERE child_capsule_id = ? LIMIT 1"
      )
        .bind(rootCapsuleId)
        .first<{ parent_capsule_id?: string | null }>();

      const parentId = parentRow?.parent_capsule_id ? String(parentRow.parent_capsule_id) : null;
      if (!parentId) {
        break;
      }

      if (directParentId === null && rootCapsuleId === targetCapsuleId) {
        directParentId = parentId;
      }

      if (ancestrySeen.has(parentId)) {
        return json({ error: "Remix ancestry loop detected", code: ERROR_REMIX_CYCLE_DETECTED }, 400);
      }

      if (i === MAX_PARENT_HOPS - 1) {
        ancestryTruncated = true;
        break;
      }

      rootCapsuleId = parentId;
    }

    const nodes = new Map<string, NodeState>();
    nodes.set(rootCapsuleId, {
      capsuleId: rootCapsuleId,
      parentId: null,
      children: new Set<string>(),
      depth: 0,
    });

    const parentQueue: Array<{ id: string; depth: number }> = [{ id: rootCapsuleId, depth: 0 }];
    const parentsSeen = new Set<string>([rootCapsuleId]);
    let traversalTruncated = false;

    while (parentQueue.length > 0 && nodes.size < MAX_TREE_NODES) {
      const batch = parentQueue.splice(0, MAX_CHILD_BATCH);
      const placeholders = batch.map(() => "?").join(",");
      const { results } = await env.DB.prepare(
        `SELECT parent_capsule_id, child_capsule_id, created_at FROM remixes WHERE parent_capsule_id IN (${placeholders})`
      )
        .bind(...batch.map((item) => item.id))
        .all<RemixRow>();

      for (const row of results || []) {
        const parentId = row.parent_capsule_id ? String(row.parent_capsule_id) : null;
        const childId = row.child_capsule_id ? String(row.child_capsule_id) : null;
        if (!parentId || !childId) {
          continue;
        }

        const parentDepth =
          nodes.get(parentId)?.depth ??
          batch.find((entry) => entry.id === parentId)?.depth ??
          0;
        const parentNode =
          nodes.get(parentId) ??
          ({
            capsuleId: parentId,
            parentId: null,
            children: new Set<string>(),
            depth: parentDepth,
          } satisfies NodeState);
        nodes.set(parentId, parentNode);
        parentNode.children.add(childId);

        const childDepth = parentDepth + 1;
        const childExists = nodes.has(childId);
        if (!childExists && nodes.size >= MAX_TREE_NODES) {
          traversalTruncated = true;
          continue;
        }
        const childNode =
          nodes.get(childId) ??
          ({
            capsuleId: childId,
            parentId,
            children: new Set<string>(),
            depth: childDepth,
          } satisfies NodeState);
        if (childNode.parentId === null) {
          childNode.parentId = parentId;
        }
        childNode.depth = Math.min(childNode.depth, childDepth);
        nodes.set(childId, childNode);

        if (nodes.size >= MAX_TREE_NODES) {
          traversalTruncated = true;
          continue;
        }
        if (!parentsSeen.has(childId)) {
          parentsSeen.add(childId);
          parentQueue.push({ id: childId, depth: childDepth });
        }
      }
    }

    const capsuleIds = Array.from(nodes.keys());
    const visibilitySupported = await hasPostVisibilityColumn(env);
    const postsByCapsule = new Map<
      string,
      {
        postId: string | null;
        title: string | null;
        description: string | null;
        authorId: string | null;
        authorHandle: string | null;
        authorDisplayName: string | null;
        createdAt: number | null;
      }
    >();

    if (capsuleIds.length > 0) {
      const placeholders = capsuleIds.map(() => "?").join(",");
      const visibilityWhere = visibilitySupported ? "(p.visibility IS NULL OR p.visibility = 'public')" : "1=1";
      const { results } = await env.DB.prepare(
        `SELECT p.id as post_id, p.title, p.description, p.capsule_id, p.created_at,
                u.id as author_id, u.handle as author_handle, u.name as author_name,
                pr.display_name as profile_display_name
         FROM posts p
         INNER JOIN users u ON p.author_id = u.id
         LEFT JOIN profiles pr ON pr.user_id = u.id
         WHERE p.capsule_id IN (${placeholders})
           AND (p.quarantined IS NULL OR p.quarantined = 0)
           AND (u.is_suspended = 0 AND u.shadow_banned = 0)
           AND ${visibilityWhere}
         ORDER BY p.created_at DESC`
      )
        .bind(...capsuleIds)
        .all<PostRow>();

      for (const row of results || []) {
        const ownerCapsuleId = row.capsule_id ? String(row.capsule_id) : null;
        if (!ownerCapsuleId || postsByCapsule.has(ownerCapsuleId)) {
          continue;
        }
        postsByCapsule.set(ownerCapsuleId, {
          postId: row.post_id ? String(row.post_id) : null,
          title: normalizeText(row.title),
          description: normalizeText(row.description),
          authorId: row.author_id ? String(row.author_id) : null,
          authorHandle: normalizeText(row.author_handle),
          authorDisplayName: normalizeText(row.profile_display_name ?? row.author_name),
          createdAt: typeof row.created_at === "number" ? row.created_at : Number(row.created_at ?? 0) || null,
        });
      }
    }

    const responseNodes = Array.from(nodes.values())
      .map((node) => {
        const meta = postsByCapsule.get(node.capsuleId);
        return {
          capsuleId: node.capsuleId,
          postId: meta?.postId ?? null,
          title: meta?.title ?? null,
          description: meta?.description ?? null,
          authorId: meta?.authorId ?? null,
          authorHandle: meta?.authorHandle ?? null,
          authorDisplayName: meta?.authorDisplayName ?? null,
          createdAt: meta?.createdAt ?? null,
          parentId: node.parentId,
          children: Array.from(node.children),
          depth: node.depth,
          remixCount: node.children.size,
          isRequested: node.capsuleId === targetCapsuleId,
        };
      })
      .sort((a, b) => a.depth - b.depth || (a.title ?? "").localeCompare(b.title ?? ""));

    return json({
      rootCapsuleId,
      requestedCapsuleId: targetCapsuleId,
      directParentId,
      nodes: responseNodes,
      truncated: ancestryTruncated || traversalTruncated,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(`${ERROR_REMIX_TREE_FAILED} remix tree fetch failed`, {
      capsuleId: targetCapsuleId,
      error: errorMessage,
      stack: errorStack,
    });
    return json(
      {
        error: "Failed to load remix lineage",
        code: ERROR_REMIX_TREE_FAILED,
        details: errorMessage,
      },
      500
    );
  }
};
