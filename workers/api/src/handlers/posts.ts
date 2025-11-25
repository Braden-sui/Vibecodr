import { verifyAuth, isModeratorOrAdmin, requireUser } from "../auth";
import { buildCapsuleSummary } from "../capsule-manifest";
import { ApiFeedResponseSchema, ApiFeedPostSchema, type ApiFeedPost } from "../contracts";
import { computeForYouScore } from "../feed/scoring";
import { getLatestArtifactsWithCache } from "../feed-artifacts";
import { hasPostVisibilityColumn } from "../lib/postsVisibility";
import { validateFeedPagination } from "../lib/pagination";
import { json } from "../lib/responses";
import { createPostSchema, normalizePostType } from "../schema";
import { getCapsuleKey } from "../storage/r2";
import type { Env, Handler } from "../types";
import { incrementUserCounters } from "./counters";
import { Plan, normalizePlan } from "@vibecodr/shared";
import { postTypes, type PostType } from "@vibecodr/shared";

function runtimeArtifactsEnabled(env: Env): boolean {
  const flag = env.RUNTIME_ARTIFACTS_ENABLED;
  if (typeof flag !== "string") return true;
  return flag.trim().toLowerCase() !== "false";
}

function sanitizePostType(raw: unknown, context: { postId?: string } = {}): PostType {
  const candidate = typeof raw === "string" ? raw : "";
  const normalized = candidate === "report" ? "thought" : candidate;
  if (postTypes.includes(normalized as PostType)) {
    return normalized as PostType;
  }
  console.warn("E-VIBECODR-0410 normalized unknown post type", {
    rawType: raw,
    postId: context.postId,
  });
  return "thought";
}

export async function getPosts(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "latest";
  const pagination = validateFeedPagination(url);
  if (!pagination.ok) {
    return pagination.response;
  }
  const { limit, offset } = pagination;
  const userIdParam = url.searchParams.get("userId");
  const tagsParam = url.searchParams.get("tags");
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const tagList = (tagsParam || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  try {
    const authedUser = await verifyAuth(req, env);
    const runtimeEnabled = runtimeArtifactsEnabled(env);
    const isMod = !!(authedUser && isModeratorOrAdmin(authedUser));
    const hasVisibility = await hasPostVisibilityColumn(env);
    let query = `
      SELECT
        p.id, p.type, p.title, p.description, p.tags, p.cover_key, ${hasVisibility ? "p.visibility" : "'public' as visibility"}, p.created_at,
        u.id as author_id, u.handle as author_handle, u.name as author_name, u.avatar_url as author_avatar, u.bio as author_bio,
        u.followers_count as author_followers_count,
        u.runs_count as author_runs_count,
        u.remixes_count as author_remixes_count,
        u.is_featured as author_is_featured,
        u.plan as author_plan,
        u.is_suspended as author_is_suspended,
        u.shadow_banned as author_shadow_banned,
        pr.display_name as profile_display_name,
        pr.avatar_url as profile_avatar,
        pr.bio as profile_bio,
        c.id as capsule_id, c.manifest_json, c.hash as capsule_hash
      FROM posts p
      INNER JOIN users u ON p.author_id = u.id
      LEFT JOIN profiles pr ON pr.user_id = u.id
      LEFT JOIN capsules c ON p.capsule_id = c.id
    `;

    const bindings: any[] = [];

    // Build WHERE clauses (safety + optional mode/tags/q)
    const where: string[] = [];
    // Safety: exclude suspended or shadow-banned authors from surfaced feeds
    where.push("(u.is_suspended = 0 AND u.shadow_banned = 0)");
    // Only surface public posts in feeds; legacy rows without visibility are treated as public.
    if (hasVisibility) {
      where.push("(p.visibility IS NULL OR p.visibility = 'public')");
    }
    // Hide quarantined posts from all surfaced feeds, including moderators/admins.
    where.push("(p.quarantined IS NULL OR p.quarantined = 0)");

    if (mode === "following") {
      let followerId: string | null = null;
      if (authedUser) {
        followerId = authedUser.userId;
      } else if (userIdParam) {
        followerId = userIdParam;
      } else {
        return json({ error: "userId required for following mode" }, 400);
      }

      where.push(`p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)`);
      bindings.push(followerId);
    }

    if (tagList.length > 0) {
      // Simple overlap check against JSON text tags: match '"tag"' in the tags string
      const tagConds = tagList.map(() => "(p.tags IS NOT NULL AND p.tags LIKE ?)");
      where.push(`(${tagConds.join(" OR ")})`);
      tagList.forEach((t) => bindings.push(`%"${t}"%`));
    }

    if (q) {
      // naive text filter over title/description/tags
      where.push("(LOWER(p.title) LIKE ? OR LOWER(p.description) LIKE ? OR (p.tags IS NOT NULL AND LOWER(p.tags) LIKE ?))");
      bindings.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    if (where.length > 0) {
      query += " WHERE " + where.join(" AND ");
    }

    // Default ordering is recency; For You will re-rank after fetch
    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    bindings.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...bindings).all();

    // Filter any bad rows for safety (defense-in-depth)
    const safeRows = (results || []).filter((row: any) => {
      const visibility = row.visibility || "public";
      return row.author_is_suspended === 0 && row.author_shadow_banned === 0 && visibility === "public";
    });

    const postIds = safeRows.map((row: any) => row.id);
    const authorIds = Array.from(new Set(safeRows.map((row: any) => row.author_id))) as string[];
    const capsuleIds = Array.from(
      new Set(
        safeRows
          .map((row: any) => row.capsule_id)
          .filter((id: string | null | undefined) => !!id)
      )
    ) as string[];

    const likesByPost = new Map<string, number>();
    const commentsByPost = new Map<string, number>();
    const runsByCapsule = new Map<string, number>();
    const remixesByCapsule = new Map<string, number>();
    const artifactIdsByCapsule = new Map<string, string>();
    const viewerLikedPosts = new Set<string>();
    const viewerFollowedAuthors = new Set<string>();

    if (postIds.length > 0) {
      const placeholders = postIds.map(() => "?").join(",");

      const likesQuery = `
        SELECT post_id, COUNT(*) as count
        FROM likes
        WHERE post_id IN (${placeholders})
        GROUP BY post_id
      `;

      const commentsBase = `
        SELECT post_id, COUNT(*) as count
        FROM comments
        WHERE post_id IN (${placeholders})
      `;

      const commentsQuery = isMod
        ? `${commentsBase}
           GROUP BY post_id`
        : `${commentsBase}
           AND (quarantined IS NULL OR quarantined = 0)
           GROUP BY post_id`;

      const [likesResult, commentsResult] = await Promise.all([
        env.DB.prepare(likesQuery).bind(...postIds).all(),
        env.DB.prepare(commentsQuery).bind(...postIds).all(),
      ]);

      for (const row of likesResult.results || []) {
        const record = row as Record<string, unknown>;
        if (record.post_id !== undefined && record.post_id !== null) {
          likesByPost.set(String(record.post_id), Number(record.count ?? 0));
        }
      }
      for (const row of commentsResult.results || []) {
        const record = row as Record<string, unknown>;
        if (record.post_id !== undefined && record.post_id !== null) {
          commentsByPost.set(String(record.post_id), Number(record.count ?? 0));
        }
      }
    }

    if (capsuleIds.length > 0) {
      const placeholders = capsuleIds.map(() => "?").join(",");

      const runsQuery = `
        SELECT capsule_id, COUNT(*) as count
        FROM runs
        WHERE capsule_id IN (${placeholders})
        GROUP BY capsule_id
      `;

      const remixesQuery = `
        SELECT parent_capsule_id, COUNT(*) as count
        FROM remixes
        WHERE parent_capsule_id IN (${placeholders})
        GROUP BY parent_capsule_id
      `;

      const runsPromise = env.DB.prepare(runsQuery).bind(...capsuleIds).all();
      const remixesPromise = env.DB.prepare(remixesQuery).bind(...capsuleIds).all();
      const [runsResult, remixesResult] = await Promise.all([runsPromise, remixesPromise]);
      let latestArtifactMap = new Map<string, { artifactId: string; createdAt: number }>();
      if (runtimeEnabled) {
        latestArtifactMap = await getLatestArtifactsWithCache(env, capsuleIds);
      }

      for (const row of runsResult.results || []) {
        const record = row as Record<string, unknown>;
        if (record.capsule_id !== undefined && record.capsule_id !== null) {
          runsByCapsule.set(String(record.capsule_id), Number(record.count ?? 0));
        }
      }
      for (const row of remixesResult.results || []) {
        const record = row as Record<string, unknown>;
        if (record.parent_capsule_id !== undefined && record.parent_capsule_id !== null) {
          remixesByCapsule.set(String(record.parent_capsule_id), Number(record.count ?? 0));
        }
      }

      if (runtimeEnabled) {
        for (const [capsuleId, info] of latestArtifactMap.entries()) {
          artifactIdsByCapsule.set(capsuleId, info.artifactId);
        }
      }
    }

    if (authedUser) {
      const viewerTasks: Promise<void>[] = [];
      if (postIds.length > 0) {
        const placeholders = postIds.map(() => "?").join(",");
        viewerTasks.push(
          env.DB.prepare(
            `SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${placeholders})`
          )
            .bind(authedUser.userId, ...postIds)
            .all()
            .then((res) => {
              for (const row of res.results || []) {
                const record = row as Record<string, unknown>;
                if (record.post_id !== undefined && record.post_id !== null) {
                  viewerLikedPosts.add(String(record.post_id));
                }
              }
            })
        );
      }
      if (authorIds.length > 0) {
        const placeholders = authorIds.map(() => "?").join(",");
        viewerTasks.push(
          env.DB.prepare(
            `SELECT followee_id FROM follows WHERE follower_id = ? AND followee_id IN (${placeholders})`
          )
            .bind(authedUser.userId, ...authorIds)
            .all()
            .then((res) => {
              for (const row of res.results || []) {
                const record = row as Record<string, unknown>;
                if (record.followee_id !== undefined && record.followee_id !== null) {
                  viewerFollowedAuthors.add(String(record.followee_id));
                }
              }
            })
        );
      }
      if (viewerTasks.length > 0) {
        await Promise.all(viewerTasks);
      }
    }

    const posts: ApiFeedPost[] = safeRows.map((row: any) => {
      const postType = sanitizePostType(row.type, { postId: row.id });
      const runsCount = row.capsule_id ? runsByCapsule.get(row.capsule_id) ?? 0 : 0;
      const remixCount = row.capsule_id ? remixesByCapsule.get(row.capsule_id) ?? 0 : 0;
      const commentCount = commentsByPost.get(row.id) ?? 0;
      const likeCount = likesByPost.get(row.id) ?? 0;

      const capsuleSummary = buildCapsuleSummary(row.capsule_id, row.manifest_json, {
        source: "feed",
        postId: row.id,
      });

      const contentHash = row.capsule_hash ? String(row.capsule_hash) : null;

      if (capsuleSummary && row.capsule_id) {
        if (runtimeEnabled) {
          const artifactId = artifactIdsByCapsule.get(row.capsule_id);
          if (artifactId) {
            capsuleSummary.artifactId = artifactId;
          }
        } else if (contentHash && typeof capsuleSummary.entry === "string") {
          capsuleSummary.bundleKey = getCapsuleKey(contentHash, capsuleSummary.entry);
          capsuleSummary.contentHash = contentHash;
        }
      }

      const authorProfile = {
        displayName: row.profile_display_name ?? null,
        avatarUrl: row.profile_avatar ?? null,
        bio: row.profile_bio ?? null,
      };

      const authorName = row.profile_display_name ?? row.author_name ?? null;
      const authorAvatar = row.profile_avatar ?? row.author_avatar ?? null;
      const authorBio = row.profile_bio ?? row.author_bio ?? null;
      const authorPlan = normalizePlan(row.author_plan, Plan.FREE);

      const post: ApiFeedPost & { viewer?: { liked: boolean; followingAuthor: boolean }; score?: number } = {
        id: row.id,
        type: postType,
        title: row.title,
        description: row.description,
        tags: row.tags ? JSON.parse(row.tags) : [],
        author: {
          id: row.author_id,
          handle: row.author_handle,
          name: authorName,
          avatarUrl: authorAvatar,
          bio: authorBio,
          followersCount: row.author_followers_count || 0,
          runsCount: row.author_runs_count || 0,
          remixesCount: row.author_remixes_count || 0,
          isFeatured: row.author_is_featured === 1,
          plan: authorPlan,
          profile: authorProfile,
        },
        capsule: capsuleSummary,
        coverKey: row.cover_key ?? null,
        createdAt: row.created_at,
        stats: {
          runs: runsCount,
          comments: commentCount,
          likes: likeCount,
          remixes: remixCount,
        },
      };

      if (authedUser) {
        post.viewer = {
          liked: viewerLikedPosts.has(row.id),
          followingAuthor: viewerFollowedAuthors.has(row.author_id),
        };
      }

      // Attach a score field for potential re-ranking
      if (mode === "foryou") {
        const nowSec = Math.floor(Date.now() / 1000);
        const authorFollowers = Number(row.author_followers_count || 0);
        const score = computeForYouScore({
          createdAtSec: Number(row.created_at),
          nowSec,
          stats: post.stats,
          authorFollowers,
          authorIsFeatured: row.author_is_featured === 1,
          authorPlan,
          hasCapsule: !!row.capsule_id,
        });

        post.score = score;
      }

      return post;
    });

    // Re-rank For You by score if present
    let finalPosts = posts;
    if (mode === "foryou") {
      finalPosts = [...posts].sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0) || Number(b.createdAt) - Number(a.createdAt));
    }

    const payload = { posts: finalPosts, mode, limit, offset };
    const parsed = ApiFeedResponseSchema.parse(payload);
    return json(parsed);
  } catch (error) {
    return json({ error: "Failed to fetch posts", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}

export async function getPostById(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>
): Promise<Response> {
  const postId = params.p1;
  if (!postId) {
    return json({ error: "postId required" }, 400);
  }

  try {
    const authedUser = await verifyAuth(req, env);
    const runtimeEnabled = runtimeArtifactsEnabled(env);
    const isMod = !!(authedUser && isModeratorOrAdmin(authedUser));
    const hasVisibility = await hasPostVisibilityColumn(env);

    let query = `
      SELECT
        p.id, p.type, p.title, p.description, p.tags, p.cover_key, ${hasVisibility ? "p.visibility" : "'public' as visibility"}, p.created_at,
        u.id as author_id, u.handle as author_handle, u.name as author_name, u.avatar_url as author_avatar, u.bio as author_bio,
        u.followers_count as author_followers_count,
        u.runs_count as author_runs_count,
        u.remixes_count as author_remixes_count,
        u.is_featured as author_is_featured,
        u.plan as author_plan,
        u.is_suspended as author_is_suspended,
        u.shadow_banned as author_shadow_banned,
        pr.display_name as profile_display_name,
        pr.avatar_url as profile_avatar,
        pr.bio as profile_bio,
        c.id as capsule_id, c.manifest_json, c.hash as capsule_hash
      FROM posts p
      INNER JOIN users u ON p.author_id = u.id
      LEFT JOIN profiles pr ON pr.user_id = u.id
      LEFT JOIN capsules c ON p.capsule_id = c.id
      WHERE p.id = ?
    `;

    const bindings: any[] = [postId];

    const where: string[] = [];
    // Safety: exclude suspended or shadow-banned authors from surfaced feeds
    where.push("(u.is_suspended = 0 AND u.shadow_banned = 0)");
    if (!isMod) {
      where.push("(p.quarantined IS NULL OR p.quarantined = 0)");
    }

    if (where.length > 0) {
      query += " AND " + where.join(" AND ");
    }

    const { results } = await env.DB.prepare(query).bind(...bindings).all();
    const row: any = results && results[0];

    if (!row) {
      return json({ error: "Post not found" }, 404);
    }

    const viewerId = authedUser?.userId ?? null;
    const viewerIsAuthor = viewerId === row.author_id;
    const canBypassVisibility = isMod || viewerIsAuthor;
    const isPublic = !hasVisibility || !row.visibility || row.visibility === "public";
    if (!isPublic && !canBypassVisibility) {
      return json({ error: "Post not found" }, 404);
    }

    const [likeCount, commentCount, runCount, remixCount] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as count FROM likes WHERE post_id = ?").bind(row.id).first(),
      isMod
        ? env.DB.prepare("SELECT COUNT(*) as count FROM comments WHERE post_id = ?").bind(row.id).first()
        : env.DB
            .prepare(
              "SELECT COUNT(*) as count FROM comments WHERE post_id = ? AND (quarantined IS NULL OR quarantined = 0)"
            )
            .bind(row.id)
            .first(),
      row.capsule_id
        ? env.DB.prepare("SELECT COUNT(*) as count FROM runs WHERE capsule_id = ?").bind(row.capsule_id).first()
        : Promise.resolve({ count: 0 }),
      row.capsule_id
        ? env.DB.prepare("SELECT COUNT(*) as count FROM remixes WHERE parent_capsule_id = ?")
            .bind(row.capsule_id)
            .first()
        : Promise.resolve({ count: 0 }),
    ]);

    let artifactIdForCapsule: string | null = null;
    if (runtimeEnabled && row.capsule_id) {
      const latestArtifacts = await getLatestArtifactsWithCache(env, [row.capsule_id]);
      const latest = latestArtifacts.get(row.capsule_id);
      if (latest) {
        artifactIdForCapsule = latest.artifactId;
      }
    }

    const capsuleSummary = buildCapsuleSummary(row.capsule_id, row.manifest_json, {
      source: "post",
      postId: row.id,
    });

    const contentHash = row.capsule_hash ? String(row.capsule_hash) : null;

    if (capsuleSummary && row.capsule_id) {
      if (runtimeEnabled && artifactIdForCapsule) {
        capsuleSummary.artifactId = artifactIdForCapsule;
      } else if (contentHash && typeof capsuleSummary.entry === "string") {
        capsuleSummary.bundleKey = getCapsuleKey(contentHash, capsuleSummary.entry);
        capsuleSummary.contentHash = contentHash;
      }
    }

    const authorProfile = {
      displayName: row.profile_display_name ?? null,
      avatarUrl: row.profile_avatar ?? null,
      bio: row.profile_bio ?? null,
    };

    const authorName = row.profile_display_name ?? row.author_name ?? null;
    const authorAvatar = row.profile_avatar ?? row.author_avatar ?? null;
    const authorBio = row.profile_bio ?? row.author_bio ?? null;
    const authorPlan = normalizePlan(row.author_plan, Plan.FREE);
    const postType = sanitizePostType(row.type, { postId: row.id });

    const post: ApiFeedPost & { viewer?: { liked: boolean; followingAuthor: boolean } } = {
      id: row.id,
      type: postType,
      title: row.title,
      description: row.description,
      tags: row.tags ? JSON.parse(row.tags) : [],
      author: {
        id: row.author_id,
        handle: row.author_handle,
        name: authorName,
        avatarUrl: authorAvatar,
        bio: authorBio,
        followersCount: row.author_followers_count || 0,
        runsCount: row.author_runs_count || 0,
        remixesCount: row.author_remixes_count || 0,
        isFeatured: row.author_is_featured === 1,
        plan: authorPlan,
        profile: authorProfile,
      },
      capsule: capsuleSummary,
      coverKey: row.cover_key ?? null,
      createdAt: row.created_at,
      stats: {
        runs: Number((runCount as { count?: unknown } | null)?.count ?? 0),
        comments: Number((commentCount as { count?: unknown } | null)?.count ?? 0),
        likes: Number((likeCount as { count?: unknown } | null)?.count ?? 0),
        remixes: Number((remixCount as { count?: unknown } | null)?.count ?? 0),
      },
    };

    if (authedUser) {
      const [likedRow, followRow] = await Promise.all([
        env.DB.prepare("SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?")
          .bind(authedUser.userId, row.id)
          .first(),
        env.DB.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?")
          .bind(authedUser.userId, row.author_id)
          .first(),
      ]);
      post.viewer = {
        liked: !!likedRow,
        followingAuthor: !!followRow,
      };
    }

    const parsed = ApiFeedPostSchema.parse(post);
    return json({ post: parsed });
  } catch (error) {
    return json(
      {
        error: "Failed to fetch post",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

const createPost: Handler = requireUser(async (req, env, _ctx, _params, userId) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsedResult = createPostSchema.safeParse({
    ...(body as Record<string, unknown>),
    authorId: userId,
  });

  if (!parsedResult.success) {
    return json(
      {
        error: "Validation failed",
        details: parsedResult.error.flatten(),
      },
      400
    );
  }

  const parsed = parsedResult.data;
  const type = normalizePostType(parsed.type);
  const id = crypto.randomUUID();
  const tagsJson = parsed.tags && parsed.tags.length > 0 ? JSON.stringify(parsed.tags) : null;
  const visibility = parsed.visibility ?? "public";
  const capsuleId = type === "app" ? parsed.capsuleId ?? null : null;

  try {
    await env.DB.prepare(
      `INSERT INTO posts (id, author_id, type, capsule_id, title, description, tags, visibility, report_md, cover_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        parsed.authorId,
        type,
        capsuleId,
        parsed.title,
        parsed.description ?? null,
        tagsJson,
        visibility,
        parsed.reportMd ?? null,
        parsed.coverKey ?? null
      )
      .run();

    // Best-effort: increment user posts counter
    incrementUserCounters(env, parsed.authorId, { postsDelta: 1 }).catch((err: unknown) => {
      console.error("E-VIBECODR-0101 createPost counter update failed", {
        userId: parsed.authorId,
        postId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return json({ ok: true, id }, 201);
  } catch (error) {
    return json(
      {
        error: "Failed to create post",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

const uploadCover: Handler = requireUser(async (req, env, _ctx, _params, userId) => {
  const contentType = req.headers.get("content-type") || "";

  if (!contentType.startsWith("image/")) {
    return json({ error: "Only image uploads are allowed" }, 400);
  }

  const body = await req.arrayBuffer();
  const size = body.byteLength;

  if (size === 0) {
    return json({ error: "Empty image upload" }, 400);
  }

  // 5MB limit to match frontend validation
  const maxBytes = 5 * 1024 * 1024;
  if (size > maxBytes) {
    return json({ error: "Image too large" }, 400);
  }

  const extFromType = contentType.split("/")[1] || "bin";
  const safeExt = extFromType.split(";")[0].trim() || "bin";
  const coverId = crypto.randomUUID();
  const key = `covers/${userId}/${coverId}.${safeExt}`;

  await env.R2.put(key, body, {
    httpMetadata: {
      contentType,
    },
  });

  return json({ ok: true, key }, 201);
});

const getDiscoverPosts: Handler = async (req: Request, env: Env) => {
  const url = new URL(req.url);
  const tag = (url.searchParams.get("tag") || "").trim().toLowerCase();
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  if (!tag) return json({ error: "tag required" }, 400);

  // Reuse getPosts query path by injecting tags param and mode=foryou for scoring
  const injectUrl = new URL(req.url);
  injectUrl.searchParams.set("mode", "foryou");
  injectUrl.searchParams.set("tags", tag);
  const proxyReq = new Request(injectUrl.toString(), { method: "GET", headers: req.headers });
  return getPosts(proxyReq, env);
};

export { createPost, uploadCover, getDiscoverPosts };
