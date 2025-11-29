// Profile and user-related handlers
// References: research-social-platforms.md (Profiles section)

import type { Handler, Env } from "../types";
import { requireUser, verifyAuth, isModeratorOrAdmin } from "../auth";
import { ApiUserProfileResponseSchema, ApiUserPostsResponseSchema } from "../contracts";
import { buildCapsuleSummary } from "../capsule-manifest";
import { buildLatestArtifactMap, type CapsuleArtifactRow } from "../feed-artifacts";
import { getCapsuleKey } from "../storage/r2";
import { json } from "../lib/responses";
import { Plan, normalizePlan } from "@vibecodr/shared";

type Params = Record<string, string>;

function runtimeArtifactsEnabled(env: Env): boolean {
  const flag = env.RUNTIME_ARTIFACTS_ENABLED;
  if (typeof flag !== "string") return true;
  return flag.trim().toLowerCase() !== "false";
}

type ProfilePostRow = {
  id: string;
  type: string;
  title: string | null;
  description: string | null;
  tags: string | null;
  cover_key?: string | null;
  created_at: number | string;
  capsule_id?: string | null;
  manifest_json?: string | null;
  capsule_hash?: string | null;
  quarantined?: number | null;
};

type CountRow = { post_id?: unknown; count?: unknown };
type CapsuleCountRow = { capsule_id?: unknown; count?: unknown };
type RemixCountRow = { parent_capsule_id?: unknown; count?: unknown };
type ViewerLikeRow = { post_id?: unknown };

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * GET /users/:handle
 * Get user profile by handle with stats
 */
export const getUserProfile: Handler = async (req, env, ctx, params) => {
  const handle = params.p1;

  try {
    // Get user basic info
    const user = await env.DB.prepare(
      "SELECT id, handle, name, avatar_url, bio, plan, created_at FROM users WHERE handle = ?"
    ).bind(handle).first();

    if (!user) {
      return json({ error: "User not found" }, 404);
    }

    // Get stats in parallel
    const [
      followerCount,
      followingCount,
      postCount,
      runCount,
      remixCount,
    ] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as count FROM follows WHERE followee_id = ?")
        .bind(user.id).first(),
      env.DB.prepare("SELECT COUNT(*) as count FROM follows WHERE follower_id = ?")
        .bind(user.id).first(),
      env.DB.prepare("SELECT COUNT(*) as count FROM posts WHERE author_id = ?")
        .bind(user.id).first(),
      env.DB.prepare(`
        SELECT COUNT(*) as count FROM runs r
        INNER JOIN capsules c ON r.capsule_id = c.id
        WHERE c.owner_id = ?
      `).bind(user.id).first(),
      env.DB.prepare(`
        SELECT COUNT(*) as count FROM remixes rem
        INNER JOIN capsules c ON rem.child_capsule_id = c.id
        WHERE c.owner_id = ?
      `).bind(user.id).first(),
    ]);

    const payload = {
      user: {
        id: user.id,
        handle: user.handle,
        name: user.name,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        plan: normalizePlan(user.plan, Plan.FREE),
        createdAt: user.created_at,
        stats: {
          followers: followerCount?.count || 0,
          following: followingCount?.count || 0,
          posts: postCount?.count || 0,
          runs: runCount?.count || 0,
          remixes: remixCount?.count || 0,
        },
      },
    };

    const parsed = ApiUserProfileResponseSchema.parse(payload);
    return json(parsed);
  } catch (error) {
    return json({
      error: "Failed to fetch user profile",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
};

/**
 * GET /users/:handle/posts?limit=20&offset=0
 * Get posts by user
 */
export const getUserPosts: Handler = async (req, env, ctx, params) => {
  const handle = params.p1;
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const runtimeEnabled = runtimeArtifactsEnabled(env);

  try {
    // Get user ID from handle
    const user = await env.DB.prepare(
      "SELECT id FROM users WHERE handle = ?"
    ).bind(handle).first();

    if (!user) {
      return json({ error: "User not found" }, 404);
    }

    // Get posts with capsule info
    const authedUser = await verifyAuth(req, env);
    const isMod = !!(authedUser && isModeratorOrAdmin(authedUser));
    const isOwnProfile = !!(authedUser && authedUser.userId === String(user.id));

    let query = `
      SELECT
        p.id, p.type, p.title, p.description, p.tags, p.cover_key, p.created_at,
        p.quarantined,
        c.id as capsule_id, c.manifest_json, c.hash as capsule_hash
      FROM posts p
      LEFT JOIN capsules c ON p.capsule_id = c.id
      WHERE p.author_id = ?`;

    // Authors can see their own quarantined posts; others cannot.
    // This allows authors to know when their content has been moderated.
    if (!isOwnProfile) {
      query += " AND (p.quarantined IS NULL OR p.quarantined = 0)";
    }

    query += " ORDER BY p.created_at DESC LIMIT ? OFFSET ?";

    const { results } = await env.DB.prepare(query).bind(user.id, limit, offset).all();

    const rows = asArray<ProfilePostRow>(results);
    const postIds = rows.map((row) => row.id);
    const capsuleIds = Array.from(
      new Set(
        rows
          .map((row) => row.capsule_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );

    const likesByPost = new Map<string, number>();
    const commentsByPost = new Map<string, number>();
    const runsByCapsule = new Map<string, number>();
    const remixesByCapsule = new Map<string, number>();
    const artifactIdsByCapsule = new Map<string, string>();
    const viewerLikedPosts = new Set<string>();
    let viewerFollowsAuthor = false;

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

      for (const row of asArray<CountRow>(likesResult.results)) {
        if (row.post_id === undefined || row.post_id === null) continue;
        likesByPost.set(String(row.post_id), toNumber(row.count));
      }
      for (const row of asArray<CountRow>(commentsResult.results)) {
        if (row.post_id === undefined || row.post_id === null) continue;
        commentsByPost.set(String(row.post_id), toNumber(row.count));
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

      const artifactsQuery = `
        SELECT capsule_id, id, created_at
        FROM artifacts
        WHERE capsule_id IN (${placeholders})
          AND status = 'active'
          AND policy_status = 'active'
          AND visibility IN ('public','unlisted')
        ORDER BY created_at DESC
      `;

      const runsPromise = env.DB.prepare(runsQuery).bind(...capsuleIds).all();
      const remixesPromise = env.DB.prepare(remixesQuery).bind(...capsuleIds).all();
      const artifactsPromise = runtimeEnabled
        ? env.DB.prepare(artifactsQuery).bind(...capsuleIds).all()
        : Promise.resolve({ results: [] });

      const [runsResult, remixesResult, artifactsResult] = await Promise.all([
        runsPromise,
        remixesPromise,
        artifactsPromise,
      ]);

      for (const row of asArray<CapsuleCountRow>(runsResult.results)) {
        if (row.capsule_id === undefined || row.capsule_id === null) continue;
        runsByCapsule.set(String(row.capsule_id), toNumber(row.count));
      }
      for (const row of asArray<RemixCountRow>(remixesResult.results)) {
        if (row.parent_capsule_id === undefined || row.parent_capsule_id === null) continue;
        remixesByCapsule.set(String(row.parent_capsule_id), toNumber(row.count));
      }

      if (runtimeEnabled) {
        const latestArtifacts = buildLatestArtifactMap((artifactsResult.results || []) as CapsuleArtifactRow[]);
        for (const [capsuleId, artifactId] of latestArtifacts.entries()) {
          artifactIdsByCapsule.set(capsuleId, artifactId);
        }
      }
    }

    if (authedUser) {
      if (postIds.length > 0) {
        const placeholders = postIds.map(() => "?").join(",");
        const viewerLikes = await env.DB.prepare(
          `SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${placeholders})`
        )
          .bind(authedUser.userId, ...postIds)
          .all();
        for (const row of asArray<ViewerLikeRow>(viewerLikes.results)) {
          if (row.post_id !== undefined && row.post_id !== null) {
            viewerLikedPosts.add(String(row.post_id));
          }
        }
      }
      const followRow = await env.DB.prepare(
        "SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?"
      )
        .bind(authedUser.userId, user.id)
        .first();
      viewerFollowsAuthor = !!followRow;
    }

    const userRecord = user as Record<string, unknown>;
    const authorProfile = {
      displayName: typeof userRecord.profile_display_name === "string" ? userRecord.profile_display_name : null,
      avatarUrl: typeof userRecord.profile_avatar_url === "string" ? userRecord.profile_avatar_url : null,
      bio: typeof userRecord.profile_bio === "string" ? userRecord.profile_bio : null,
    };
    const authorName = authorProfile.displayName ?? (typeof userRecord.name === "string" ? userRecord.name : null);
    const authorAvatar = authorProfile.avatarUrl ?? (typeof userRecord.avatar_url === "string" ? userRecord.avatar_url : null);
    const authorBio = authorProfile.bio ?? (typeof userRecord.bio === "string" ? userRecord.bio : null);
    const authorPlan = normalizePlan(userRecord.plan, Plan.FREE);
    const author = {
      id: String(userRecord.id),
      handle: typeof userRecord.handle === "string" ? userRecord.handle : handle,
      name: authorName,
      avatarUrl: authorAvatar,
      bio: authorBio,
      followersCount: toNumber(userRecord.followers_count),
      runsCount: toNumber(userRecord.runs_count),
      remixesCount: toNumber(userRecord.remixes_count),
      isFeatured: Number(userRecord.is_featured ?? 0) === 1,
      plan: authorPlan,
      profile: authorProfile,
    };

    const posts = rows.map((row) => {
      const likeCount = likesByPost.get(row.id) ?? 0;
      const commentCount = commentsByPost.get(row.id) ?? 0;
      const runsCount = row.capsule_id ? runsByCapsule.get(row.capsule_id) ?? 0 : 0;
      const remixCount = row.capsule_id ? remixesByCapsule.get(row.capsule_id) ?? 0 : 0;
      const viewer = authedUser
        ? {
            liked: viewerLikedPosts.has(row.id),
            followingAuthor: viewerFollowsAuthor,
          }
        : undefined;

      const capsuleSummary = buildCapsuleSummary(row.capsule_id, row.manifest_json, {
        source: "profilePosts",
        postId: row.id,
      });

      if (capsuleSummary && row.capsule_id) {
        const contentHash = row.capsule_hash ? String(row.capsule_hash) : null;
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

      // Include quarantined flag only for own posts that are quarantined
      const isQuarantined = Number(row.quarantined ?? 0) === 1;

      return {
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        tags: row.tags ? JSON.parse(row.tags) : [],
        author,
        capsule: capsuleSummary,
        coverKey: row.cover_key ?? null,
        createdAt: row.created_at,
        stats: {
          likes: likeCount,
          comments: commentCount,
          remixes: remixCount,
          runs: runsCount,
        },
        viewer,
        // Only include quarantined field when true (for own profile view)
        ...(isOwnProfile && isQuarantined ? { quarantined: true } : {}),
      };
    });

    const payload = { posts, limit, offset };
    const parsed = ApiUserPostsResponseSchema.parse(payload);
    return json(parsed);
  } catch (error) {
    return json({
      error: "Failed to fetch user posts",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
};

/**
 * GET /users/:userId/check-following?targetId=...
 * Check if current user follows target user
 * Requires auth
 */
export const checkFollowing: Handler = requireUser(async (req, env, ctx, params, userId) => {
  const url = new URL(req.url);
  const targetId = url.searchParams.get("targetId");

  if (!targetId) {
    return json({ error: "targetId required" }, 400);
  }

  try {
    const result = await env.DB.prepare(
      "SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?"
    ).bind(userId, targetId).first();

    return json({ following: !!result });
  } catch (error) {
    return json({
      error: "Failed to check following status",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

/**
 * GET /posts/:postId/check-liked
 * Check if current user has liked a post
 * Requires auth
 */
export const checkLiked: Handler = requireUser(async (req, env, ctx, params, userId) => {
  const postId = params.p1;

  if (!postId) {
    return json({ error: "postId required" }, 400);
  }

  try {
    const result = await env.DB.prepare(
      "SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?"
    ).bind(userId, postId).first();

    return json({ liked: !!result });
  } catch (error) {
    return json({
      error: "Failed to check like status",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
