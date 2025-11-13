// Cloudflare Worker API skeleton for Vibecodr
// Routes documented in SITEMAP.md. Each handler returns 501 with TODOs.

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ALLOWLIST_HOSTS: string; // JSON string
  CLERK_JWT_ISSUER: string;
  CLERK_JWT_AUDIENCE?: string;
  BUILD_COORDINATOR_DURABLE: DurableObjectNamespace;
  vibecodr_analytics_engine: AnalyticsEngineDataset;
}

export type Handler = (req: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>) => Promise<Response>;

// Import handlers
import {
  validateManifestHandler,
  getManifest,
  getCapsuleBundle,
} from "./handlers/manifest";

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
} from "./handlers/social";

import {
  getUserProfile,
  getUserPosts,
  checkFollowing,
  checkLiked,
} from "./handlers/profiles";
import { syncUser } from "./handlers/users";

import {
  reportContent,
  getModerationReports,
  resolveModerationReport,
  filterContent,
} from "./handlers/moderation";

import { netProxy } from "./handlers/proxy";

import {
  oEmbedHandler,
  embedIframeHandler,
  ogImageHandler,
} from "./handlers/embeds";
import { completeRun } from "./handlers/runs";
export { BuildCoordinator } from "./durable/BuildCoordinator";

// Local stub handlers (hoisted)
async function importGithub(_req: Request): Promise<Response> {
  return json({ ok: false, todo: "import github not implemented" }, 501);
}

async function importZip(_req: Request): Promise<Response> {
  return json({ ok: false, todo: "import zip not implemented" }, 501);
}

async function appendRunLogs(_req: Request, _env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  return json({ ok: false, runId: params.p1, todo: "logs not implemented" }, 501);
}

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
    } catch {}
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch (e: any) {
    return json({ error: "do status failed", details: e?.message || "unknown" }, 500);
  }
}

async function getPosts(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "latest";
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const userId = url.searchParams.get("userId");
  const tagsParam = url.searchParams.get("tags");
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const tagList = (tagsParam || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  try {
    let query = `
      SELECT
        p.id, p.type, p.title, p.description, p.tags, p.created_at,
        u.id as author_id, u.handle as author_handle, u.name as author_name, u.avatar_url as author_avatar,
        u.followers_count as author_followers_count,
        u.runs_count as author_runs_count,
        u.remixes_count as author_remixes_count,
        u.is_featured as author_is_featured,
        u.plan as author_plan,
        u.is_suspended as author_is_suspended,
        u.shadow_banned as author_shadow_banned,
        c.id as capsule_id, c.manifest_json
      FROM posts p
      INNER JOIN users u ON p.author_id = u.id
      LEFT JOIN capsules c ON p.capsule_id = c.id
    `;

    const bindings: any[] = [];

    // Build WHERE clauses (safety + optional mode/tags/q)
    const where: string[] = [];
    // Safety: exclude suspended or shadow-banned authors from surfaced feeds
    where.push("(u.is_suspended = 0 AND u.shadow_banned = 0)");

    if (mode === "following") {
      if (!userId) {
        return json({ error: "userId required for following mode" }, 400);
      }
      where.push(`p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)`);
      bindings.push(userId);
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

    if (mode === "following") {
      if (!userId) {
        return json({ error: "userId required for following mode" }, 400);
      }
      query += ` WHERE p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)`;
      bindings.push(userId);
    }

    // Default ordering is recency; For You will re-rank after fetch
    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    bindings.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...bindings).all();

    // Filter any bad rows for safety (defense-in-depth)
    const safeRows = (results || []).filter((row: any) => row.author_is_suspended === 0 && row.author_shadow_banned === 0);

    const posts = await Promise.all(safeRows.map(async (row: any) => {
      const [likeCount, commentCount, runCount, remixCount] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) as count FROM likes WHERE post_id = ?").bind(row.id).first(),
        env.DB.prepare("SELECT COUNT(*) as count FROM comments WHERE post_id = ?").bind(row.id).first(),
        row.capsule_id ? env.DB.prepare("SELECT COUNT(*) as count FROM runs WHERE capsule_id = ?").bind(row.capsule_id).first() : Promise.resolve({ count: 0 }),
        row.capsule_id ? env.DB.prepare("SELECT COUNT(*) as count FROM remixes WHERE parent_capsule_id = ?").bind(row.capsule_id).first() : Promise.resolve({ count: 0 }),
      ]);

      const post = {
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        tags: row.tags ? JSON.parse(row.tags) : [],
        author: {
          id: row.author_id,
          handle: row.author_handle,
          name: row.author_name,
          avatarUrl: row.author_avatar,
          followersCount: row.author_followers_count || 0,
          runsCount: row.author_runs_count || 0,
          remixesCount: row.author_remixes_count || 0,
          isFeatured: row.author_is_featured === 1,
          plan: row.author_plan || "free",
        },
        capsule: row.capsule_id ? { id: row.capsule_id, ...JSON.parse(row.manifest_json) } : null,
        createdAt: row.created_at,
        stats: {
          runs: runCount?.count || 0,
          comments: commentCount?.count || 0,
          likes: likeCount?.count || 0,
          remixes: remixCount?.count || 0,
        },
      } as any;

      // Attach a score field for potential re-ranking
      if (mode === "foryou") {
        const nowSec = Math.floor(Date.now() / 1000);
        const ageHours = Math.max(0, (nowSec - Number(row.created_at)) / 3600);
        const recencyDecay = Math.exp(-ageHours / 72); // ~3-day half-life
        const log1p = (n: number) => Math.log(1 + Math.max(0, n));

        const authorFollowers = Number(row.author_followers_count || 0);
        const featuredBoost = row.author_is_featured === 1 ? 0.05 : 0;
        const planBoost = ["pro", "team"].includes(String(row.author_plan || "")) ? 0.03 : 0;

        const score =
          0.5 * recencyDecay +
          0.2 * log1p(post.stats.runs) +
          0.15 * log1p(post.stats.likes) +
          0.1 * log1p(post.stats.remixes) +
          0.05 * log1p(authorFollowers) +
          featuredBoost +
          planBoost;

        (post as any).score = score;
      }

      return post;
    }));

    // Re-rank For You by score if present
    let finalPosts = posts;
    if (mode === "foryou") {
      finalPosts = [...posts].sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0) || Number(b.createdAt) - Number(a.createdAt));
    }

    return json({ posts: finalPosts, mode, limit, offset });
  } catch (error) {
    return json({ error: "Failed to fetch posts", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}

async function createPost(_req: Request): Promise<Response> {
  return json({ ok: false, todo: "create post not implemented" }, 501);
}

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

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  // Manifest & Import
  { method: "POST", pattern: /^\/manifest\/validate$/, handler: validateManifestHandler },
  { method: "POST", pattern: /^\/import\/github$/, handler: importGithub },
  { method: "POST", pattern: /^\/import\/zip$/, handler: importZip },

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

  // Follows
  { method: "POST", pattern: /^\/users\/([^\/]+)\/follow$/, handler: followUser },
  { method: "DELETE", pattern: /^\/users\/([^\/]+)\/follow$/, handler: unfollowUser },
  { method: "GET", pattern: /^\/users\/([^\/]+)\/followers$/, handler: getUserFollowers },
  { method: "GET", pattern: /^\/users\/([^\/]+)\/following$/, handler: getUserFollowing },

  // Posts & Feed
  { method: "GET", pattern: /^\/posts$/, handler: getPosts },
  { method: "GET", pattern: /^\/posts\/discover$/, handler: getDiscoverPosts },
  { method: "POST", pattern: /^\/posts$/, handler: createPost },

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
  { method: "POST", pattern: /^\/notifications\/mark-read$/, handler: markNotificationsRead },
  { method: "GET", pattern: /^\/notifications\/unread-count$/, handler: getUnreadCount },

  // Runs & Logs
  { method: "POST", pattern: /^\/runs\/(\w+)\/logs$/, handler: appendRunLogs },
  { method: "POST", pattern: /^\/runs\/complete$/, handler: completeRun },

  // Durable Object status
  { method: "GET", pattern: /^\/do\/status$/, handler: doStatus },

  // Moderation
  { method: "POST", pattern: /^\/moderation\/report$/, handler: reportContent },
  { method: "GET", pattern: /^\/moderation\/reports$/, handler: getModerationReports },
  { method: "POST", pattern: /^\/moderation\/reports\/([^\/]+)\/resolve$/, handler: resolveModerationReport },
  { method: "POST", pattern: /^\/moderation\/filter-content$/, handler: filterContent },

  // Embeds & SEO
  { method: "GET", pattern: /^\/oembed$/, handler: oEmbedHandler },
  { method: "GET", pattern: /^\/e\/([^\/]+)$/, handler: embedIframeHandler },
  { method: "GET", pattern: /^\/og-image\/([^\/]+)$/, handler: ogImageHandler },

  // Network Proxy
  { method: "GET", pattern: /^\/proxy$/, handler: netProxy }
];

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    for (const r of routes) {
      if (req.method !== r.method) continue;
      const match = url.pathname.match(r.pattern);
      if (match) {
        const params: Record<string, string> = {};
        // naive: capture groups as p1/p2
        match.slice(1).forEach((v, i) => (params[`p${i + 1}`] = v));
        try {
          return await r.handler(req, env, ctx, params);
        } catch (e: any) {
          return json({ error: e?.message || "internal" }, 500);
        }
      }
    }
    return json({ error: "not found" }, 404);
  }
} satisfies ExportedHandler<Env>;

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" }, ...init });
}

