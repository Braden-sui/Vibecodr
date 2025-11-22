// Cloudflare Worker API implementation for Vibecod
// Routes documented in SITEMAP.md.

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  RUNTIME_MANIFEST_KV?: KVNamespace;
  ALLOWLIST_HOSTS: string; // JSON string
  CLERK_JWT_ISSUER: string;
  CLERK_JWT_AUDIENCE?: string;
  BUILD_COORDINATOR_DURABLE: DurableObjectNamespace;
  ARTIFACT_COMPILER_DURABLE: DurableObjectNamespace;
  vibecodr_analytics_engine: AnalyticsEngineDataset;
  RUNTIME_ARTIFACTS_ENABLED?: string;
  CAPSULE_BUNDLE_NETWORK_MODE?: string;
  AWSBEDROCKAPI?: string;
  BEDROCK_REGION?: string;
  BEDROCK_SAFETY_MODEL?: string;
  SAFETY_ENABLED?: string;
  SAFETY_TIMEOUT_MS?: string;
  SAFETY_BLOCKED_CODE_HASHES?: string;
  NET_PROXY_ENABLED?: string;
}

export type Handler = (req: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>) => Promise<Response>;

// Import handlers
import {
  validateManifestHandler,
  getManifest,
  getCapsuleBundle,
} from "./handlers/manifest";
import { importGithub, importZip } from "./handlers/import";

import {
  publishCapsule,
  getCapsule,
  verifyCapsule,
  getUserQuota,
} from "./handlers/capsules";

import {
  likePost,
  unlikePost,
  getPostLikes,
  followUser,
  unfollowUser,
  getUserFollowers,
  getUserFollowing,
  createComment,
  getPostComments,
  deleteComment,
  getNotifications,
  markNotificationsRead,
  getUnreadCount,
  getNotificationSummary,
} from "./handlers/social";

import {
  getUserProfile,
  getUserPosts,
  checkFollowing,
  checkLiked,
} from "./handlers/profiles";
import {
  getProfileWithLayout,
  updateProfile,
  searchProfiles,
} from "./handlers/profile-extended";
import { syncUser } from "./handlers/users";
import { verifyAuth, isModeratorOrAdmin, requireUser } from "./auth";
import { ApiFeedResponseSchema, ApiFeedPostSchema, type ApiFeedPost } from "./contracts";
import { buildCapsuleSummary } from "./capsule-manifest";
import { getLatestArtifactsWithCache } from "./feed-artifacts";
import { createPostSchema } from "./schema";
import { incrementUserCounters } from "./handlers/counters";

import {
  reportContent,
  getModerationReports,
  resolveModerationReport,
  filterContent,
  moderatePostAction,
  moderateCommentAction,
  getFlaggedPosts,
  getModerationAudit,
  getPostModerationStatus,
} from "./handlers/moderation";

import { netProxy } from "./handlers/proxy";

import {
  oEmbedHandler,
  embedIframeHandler,
  ogImageHandler,
} from "./handlers/embeds";
import { completeRun, appendRunLogs } from "./handlers/runs";
import {
  createArtifactUpload,
  uploadArtifactSources,
  completeArtifact,
  getArtifactManifest,
  getArtifactBundle,
} from "./handlers/artifacts";
import { joinLiveWaitlist } from "./handlers/live";
import { recordRuntimeEvent, getRuntimeAnalyticsSummary } from "./handlers/runtimeEvents";
export { BuildCoordinator } from "./durable/BuildCoordinator";
export { ArtifactCompiler } from "./durable/ArtifactCompiler";

async function doStatus(_req: Request, env: Env): Promise<Response> {
  try {
    const id = env.BUILD_COORDINATOR_DURABLE.idFromName("global");
    const stub = env.BUILD_COORDINATOR_DURABLE.get(id);
    const res = await stub.fetch("https://internal/status");
    try {
      env.vibecodr_analytics_engine.writeDataPoint({
        blobs: ["do_status"],
        doubles: [1],
      });
    } catch (error) {
      console.error("E-VIBECODR-0206 doStatus analytics write failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch (e: any) {
    return json({ error: "do status failed", details: e?.message || "unknown" }, 500);
  }
}

export type ForYouScoreInput = {
  createdAtSec: number;
  nowSec: number;
  stats: { runs: number; likes: number; remixes: number };
  authorFollowers: number;
  authorIsFeatured: boolean;
  authorPlan?: string | null;
  hasCapsule: boolean;
};

export function computeForYouScore(input: ForYouScoreInput): number {
  const ageHours = Math.max(0, (input.nowSec - input.createdAtSec) / 3600);
  const recencyDecay = Math.exp(-ageHours / 72); // ~3-day half-life
  const log1p = (n: number) => Math.log(1 + Math.max(0, n));

  const featuredBoost = input.authorIsFeatured ? 0.05 : 0;
  const planBoost = ["pro", "team"].includes(String(input.authorPlan || "")) ? 0.03 : 0;
  const capsuleBoost = input.hasCapsule ? 0.1 : 0;

  return (
    0.45 * recencyDecay +
    0.2 * log1p(input.stats.runs) +
    0.15 * log1p(input.stats.likes) +
    0.1 * log1p(input.stats.remixes) +
    0.05 * log1p(input.authorFollowers) +
    capsuleBoost +
    featuredBoost +
    planBoost
  );
}

const DEFAULT_FEED_LIMIT = 20;
const MAX_FEED_LIMIT = 50;

type PaginationValidationResult =
  | { ok: true; limit: number; offset: number }
  | { ok: false; response: Response };

// WHY: Prevent unbounded feed queries that would explode downstream fan-out (likes/comments/runs).
// INVARIANT: limit is clamped to MAX_FEED_LIMIT and >= 1; offset is a non-negative integer.
function validateFeedPagination(url: URL): PaginationValidationResult {
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");

  const parsedLimit = limitRaw && limitRaw.trim().length > 0 ? Number(limitRaw) : DEFAULT_FEED_LIMIT;
  const parsedOffset = offsetRaw && offsetRaw.trim().length > 0 ? Number(offsetRaw) : 0;

  if (!Number.isFinite(parsedLimit) || !Number.isInteger(parsedLimit)) {
    return {
      ok: false,
      response: json(
        {
          error: "E-VIBECODR-0401 invalid pagination",
          message: "limit must be an integer",
        },
        400
      ),
    };
  }

  if (parsedLimit <= 0) {
    return {
      ok: false,
      response: json(
        {
          error: "E-VIBECODR-0402 invalid pagination",
          message: "limit must be at least 1",
        },
        400
      ),
    };
  }

  if (!Number.isFinite(parsedOffset) || !Number.isInteger(parsedOffset)) {
    return {
      ok: false,
      response: json(
        {
          error: "E-VIBECODR-0403 invalid pagination",
          message: "offset must be an integer",
        },
        400
      ),
    };
  }

  if (parsedOffset < 0) {
    return {
      ok: false,
      response: json(
        {
          error: "E-VIBECODR-0404 invalid pagination",
          message: "offset cannot be negative",
        },
        400
      ),
    };
  }

  const limit = Math.min(parsedLimit, MAX_FEED_LIMIT);
  const offset = parsedOffset;

  return { ok: true, limit, offset };
}

async function getPosts(req: Request, env: Env): Promise<Response> {
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
    const isMod = !!(authedUser && isModeratorOrAdmin(authedUser));
    let query = `
      SELECT
        p.id, p.type, p.title, p.description, p.tags, p.cover_key, p.visibility, p.created_at,
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
        c.id as capsule_id, c.manifest_json
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
    // Only surface public posts in feeds; unlisted/private must stay hidden from timelines.
    where.push("p.visibility = 'public'");
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
    const safeRows = (results || []).filter(
      (row: any) =>
        row.author_is_suspended === 0 &&
        row.author_shadow_banned === 0 &&
        row.visibility === "public"
    );

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
        likesByPost.set((row as any).post_id, Number((row as any).count ?? 0));
      }
      for (const row of commentsResult.results || []) {
        commentsByPost.set((row as any).post_id, Number((row as any).count ?? 0));
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

      const [runsResult, remixesResult, latestArtifactMap] = await Promise.all([
        env.DB.prepare(runsQuery).bind(...capsuleIds).all(),
        env.DB.prepare(remixesQuery).bind(...capsuleIds).all(),
        getLatestArtifactsWithCache(env, capsuleIds),
      ]);

      for (const row of runsResult.results || []) {
        runsByCapsule.set((row as any).capsule_id, Number((row as any).count ?? 0));
      }
      for (const row of remixesResult.results || []) {
        remixesByCapsule.set((row as any).parent_capsule_id, Number((row as any).count ?? 0));
      }

      for (const [capsuleId, info] of latestArtifactMap.entries()) {
        artifactIdsByCapsule.set(capsuleId, info.artifactId);
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
                viewerLikedPosts.add(String((row as any).post_id));
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
                viewerFollowedAuthors.add(String((row as any).followee_id));
              }
            })
        );
      }
      if (viewerTasks.length > 0) {
        await Promise.all(viewerTasks);
      }
    }

    const posts: ApiFeedPost[] = safeRows.map((row: any) => {
      const runsCount = row.capsule_id ? runsByCapsule.get(row.capsule_id) ?? 0 : 0;
      const remixCount = row.capsule_id ? remixesByCapsule.get(row.capsule_id) ?? 0 : 0;
      const commentCount = commentsByPost.get(row.id) ?? 0;
      const likeCount = likesByPost.get(row.id) ?? 0;

      const capsuleSummary = buildCapsuleSummary(row.capsule_id, row.manifest_json, {
        source: "feed",
        postId: row.id,
      });

      if (capsuleSummary && row.capsule_id) {
        const artifactId = artifactIdsByCapsule.get(row.capsule_id);
        if (artifactId) {
          (capsuleSummary as any).artifactId = artifactId;
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

      const post = {
        id: row.id,
        type: row.type,
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
          plan: row.author_plan || "free",
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
      } as any;

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
          authorPlan: row.author_plan,
          hasCapsule: !!row.capsule_id,
        });

        (post as any).score = score;
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

async function getPostById(req: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const postId = params.p1;
  if (!postId) {
    return json({ error: "postId required" }, 400);
  }

  try {
    const authedUser = await verifyAuth(req, env);
    const isMod = !!(authedUser && isModeratorOrAdmin(authedUser));

    let query = `
      SELECT
        p.id, p.type, p.title, p.description, p.tags, p.cover_key, p.visibility, p.created_at,
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
        c.id as capsule_id, c.manifest_json
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
    const isPublic = row.visibility === "public";
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
    if (row.capsule_id) {
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

    if (capsuleSummary && artifactIdForCapsule) {
      (capsuleSummary as any).artifactId = artifactIdForCapsule;
    }

    const authorProfile = {
      displayName: row.profile_display_name ?? null,
      avatarUrl: row.profile_avatar ?? null,
      bio: row.profile_bio ?? null,
    };

    const authorName = row.profile_display_name ?? row.author_name ?? null;
    const authorAvatar = row.profile_avatar ?? row.author_avatar ?? null;
    const authorBio = row.profile_bio ?? row.author_bio ?? null;

    const post: ApiFeedPost = {
      id: row.id,
      type: row.type,
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
        plan: row.author_plan || "free",
        profile: authorProfile,
      },
      capsule: capsuleSummary,
      coverKey: row.cover_key ?? null,
      createdAt: row.created_at,
      stats: {
        runs: (runCount as any)?.count || 0,
        comments: (commentCount as any)?.count || 0,
        likes: (likeCount as any)?.count || 0,
        remixes: (remixCount as any)?.count || 0,
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

export { getPostById };

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
  const id = crypto.randomUUID();
  const tagsJson = parsed.tags && parsed.tags.length > 0 ? JSON.stringify(parsed.tags) : null;
  const visibility = parsed.visibility ?? "public";

  try {
    await env.DB.prepare(
      `INSERT INTO posts (id, author_id, type, capsule_id, title, description, tags, visibility, report_md, cover_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        parsed.authorId,
        parsed.type,
        parsed.capsuleId ?? null,
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

async function getDiscoverPosts(req: Request, env: Env): Promise<Response> {
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
}

export const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  // Manifest & Import
  { method: "POST", pattern: /^\/manifest\/validate$/, handler: validateManifestHandler },
  // Allow both /import/github and /capsules/import/github for compatibility
  { method: "POST", pattern: /^\/(?:capsules\/)?import\/github$/, handler: importGithub },
  { method: "POST", pattern: /^\/import\/zip$/, handler: importZip },

  // Artifacts
  { method: "POST", pattern: /^\/artifacts$/, handler: createArtifactUpload },
  { method: "PUT", pattern: /^\/artifacts\/([^\/]+)\/sources$/, handler: uploadArtifactSources },
  { method: "PUT", pattern: /^\/artifacts\/([^\/]+)\/complete$/, handler: completeArtifact },
  { method: "GET", pattern: /^\/artifacts\/([^\/]+)\/manifest$/, handler: getArtifactManifest },
  { method: "GET", pattern: /^\/artifacts\/([^\/]+)\/bundle$/, handler: getArtifactBundle },

  // Capsules
  { method: "POST", pattern: /^\/capsules\/publish$/, handler: publishCapsule },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)$/, handler: getCapsule },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)\/verify$/, handler: verifyCapsule },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)\/manifest$/, handler: getManifest },
  { method: "GET", pattern: /^\/capsules\/([^\/]+)\/bundle$/, handler: getCapsuleBundle },

  // User & Quota
  { method: "GET", pattern: /^\/user\/quota$/, handler: getUserQuota },

  // Profiles
  { method: "POST", pattern: /^\/users\/sync$/, handler: syncUser },
  { method: "GET", pattern: /^\/users\/([^\/]+)$/, handler: getUserProfile },
  { method: "GET", pattern: /^\/users\/([^\/]+)\/posts$/, handler: getUserPosts },
  { method: "GET", pattern: /^\/users\/([^\/]+)\/check-following$/, handler: checkFollowing },

  // Extended profile feature
  { method: "GET", pattern: /^\/profile\/([^\/]+)$/, handler: getProfileWithLayout },
  { method: "PATCH", pattern: /^\/profile$/, handler: updateProfile },
  { method: "GET", pattern: /^\/profile\/search$/, handler: searchProfiles },

  // Follows
  { method: "POST", pattern: /^\/users\/([^\/]+)\/follow$/, handler: followUser },
  { method: "DELETE", pattern: /^\/users\/([^\/]+)\/follow$/, handler: unfollowUser },
  { method: "GET", pattern: /^\/users\/([^\/]+)\/followers$/, handler: getUserFollowers },
  { method: "GET", pattern: /^\/users\/([^\/]+)\/following$/, handler: getUserFollowing },

  // Posts & Feed
  { method: "GET", pattern: /^\/posts$/, handler: getPosts },
  { method: "GET", pattern: /^\/posts\/discover$/, handler: getDiscoverPosts },
  { method: "GET", pattern: /^\/posts\/([^\/]+)$/, handler: getPostById },
  { method: "POST", pattern: /^\/posts$/, handler: createPost },
  { method: "POST", pattern: /^\/covers$/, handler: uploadCover },

  // Likes
  { method: "POST", pattern: /^\/posts\/([^\/]+)\/like$/, handler: likePost },
  { method: "DELETE", pattern: /^\/posts\/([^\/]+)\/like$/, handler: unlikePost },
  { method: "GET", pattern: /^\/posts\/([^\/]+)\/likes$/, handler: getPostLikes },
  { method: "GET", pattern: /^\/posts\/([^\/]+)\/check-liked$/, handler: checkLiked },

  // Comments
  { method: "POST", pattern: /^\/posts\/([^\/]+)\/comments$/, handler: createComment },
  { method: "GET", pattern: /^\/posts\/([^\/]+)\/comments$/, handler: getPostComments },
  { method: "DELETE", pattern: /^\/comments\/([^\/]+)$/, handler: deleteComment },

  // Notifications
  { method: "GET", pattern: /^\/notifications$/, handler: getNotifications },
  { method: "GET", pattern: /^\/notifications\/summary$/, handler: getNotificationSummary },
  { method: "POST", pattern: /^\/notifications\/mark-read$/, handler: markNotificationsRead },
  { method: "GET", pattern: /^\/notifications\/unread-count$/, handler: getUnreadCount },

  // Runtime analytics
  { method: "POST", pattern: /^\/runtime-events$/, handler: recordRuntimeEvent },
  { method: "GET", pattern: /^\/runtime-analytics\/summary$/, handler: getRuntimeAnalyticsSummary },

  // Runs & Logs
  { method: "POST", pattern: /^\/runs\/([^\/]+)\/logs$/, handler: appendRunLogs },
  { method: "POST", pattern: /^\/runs\/complete$/, handler: completeRun },

  // Durable Object status
  { method: "GET", pattern: /^\/do\/status$/, handler: doStatus },

  // Moderation
  { method: "POST", pattern: /^\/moderation\/report$/, handler: reportContent },
  { method: "POST", pattern: /^\/moderation\/posts\/([^\/]+)\/action$/, handler: moderatePostAction },
  { method: "POST", pattern: /^\/moderation\/comments\/([^\/]+)\/action$/, handler: moderateCommentAction },
  { method: "GET", pattern: /^\/moderation\/posts\/([^\/]+)\/status$/, handler: getPostModerationStatus },
  { method: "GET", pattern: /^\/moderation\/reports$/, handler: getModerationReports },
  { method: "POST", pattern: /^\/moderation\/reports\/([^\/]+)\/resolve$/, handler: resolveModerationReport },
  { method: "GET", pattern: /^\/moderation\/flagged-posts$/, handler: getFlaggedPosts },
  { method: "GET", pattern: /^\/moderation\/audit$/, handler: getModerationAudit },
  { method: "POST", pattern: /^\/moderation\/filter-content$/, handler: filterContent },
  { method: "POST", pattern: /^\/live\/waitlist$/, handler: joinLiveWaitlist },

  // Embeds & SEO
  { method: "GET", pattern: /^\/oembed$/, handler: oEmbedHandler },
  { method: "GET", pattern: /^\/e\/([^\/]+)$/, handler: embedIframeHandler },
  { method: "GET", pattern: /^\/og-image\/([^\/]+)$/, handler: ogImageHandler },

  // Network Proxy
  { method: "GET", pattern: /^\/proxy$/, handler: netProxy }
];

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    if (req.method === "OPTIONS") {
      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(req.url);
    // Allow optional /api prefix when running behind Pages/Next routing
    const pathname = url.pathname.startsWith("/api/")
      ? url.pathname.slice(4)
      : url.pathname;
    for (const r of routes) {
      if (req.method !== r.method) continue;
      const match = pathname.match(r.pattern);
      if (match) {
        const params: Record<string, string> = {};
        // naive: capture groups as p1/p2
        match.slice(1).forEach((v, i) => (params[`p${i + 1}`] = v));
        try {
          const response = await r.handler(req, env, ctx, params);
          return withCors(response);
        } catch (e: any) {
          return withCors(json({ error: e?.message || "internal" }, 500));
        }
      }
    }
    return withCors(json({ error: "not found" }, 404));
  }
} satisfies ExportedHandler<Env>;

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

function json(data: unknown, status = 200, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  return new Response(JSON.stringify(data), { status, ...init, headers });
}
