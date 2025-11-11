// Cloudflare Worker API skeleton for Vibecodr
// Routes documented in SITEMAP.md. Each handler returns 501 with TODOs.

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ALLOWLIST_HOSTS: string; // JSON string
}

type Handler = (req: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>) => Promise<Response>;

// Import handlers
import {
  validateManifestHandler,
  getManifest,
  getCapsuleBundle,
} from "./handlers/manifest";
import { importGithub, importZip } from "./handlers/import";

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

// Handlers (stubs)
const importGithub: Handler = async (req) => {
  // TODO: Accept GitHub URL, fetch repo, analyze structure
  return json({ ok: false, todo: "import github not implemented" }, 501);
};

const importZip: Handler = async (req) => {
  // TODO: Accept multipart ZIP, enqueue build, emit draft capsule
  return json({ ok: false, todo: "import zip not implemented" }, 501);
};

const appendRunLogs: Handler = async (_req, _env, _ctx, params) => {
  // TODO: Append logs with sampling; associate to run id
  return json({ ok: false, runId: params.p1, todo: "logs not implemented" }, 501);
};

const getPosts: Handler = async (req, env) => {
  // GET /posts?mode=latest|following&limit=20&offset=0&userId=...
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "latest";
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const userId = url.searchParams.get("userId"); // For following mode

  try {
    let query = `
      SELECT
        p.id, p.type, p.title, p.description, p.tags, p.created_at,
        u.id as author_id, u.handle as author_handle, u.name as author_name, u.avatar_url as author_avatar,
        c.id as capsule_id, c.manifest_json
      FROM posts p
      INNER JOIN users u ON p.author_id = u.id
      LEFT JOIN capsules c ON p.capsule_id = c.id
    `;

    let bindings: any[] = [];

    if (mode === "following") {
      if (!userId) {
        return json({ error: "userId required for following mode" }, 400);
      }
      query += ` WHERE p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)`;
      bindings.push(userId);
    }

    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    bindings.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...bindings).all();

    // Fetch stats for each post
    const posts = await Promise.all((results || []).map(async (row: any) => {
      const [likeCount, commentCount, runCount, remixCount] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) as count FROM likes WHERE post_id = ?")
          .bind(row.id).first(),
        env.DB.prepare("SELECT COUNT(*) as count FROM comments WHERE post_id = ?")
          .bind(row.id).first(),
        row.capsule_id ? env.DB.prepare("SELECT COUNT(*) as count FROM runs WHERE capsule_id = ?")
          .bind(row.capsule_id).first() : Promise.resolve({ count: 0 }),
        row.capsule_id ? env.DB.prepare("SELECT COUNT(*) as count FROM remixes WHERE parent_capsule_id = ?")
          .bind(row.capsule_id).first() : Promise.resolve({ count: 0 }),
      ]);

      return {
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
        },
        capsule: row.capsule_id
          ? {
              id: row.capsule_id,
              ...JSON.parse(row.manifest_json),
            }
          : null,
        createdAt: row.created_at,
        stats: {
          runs: runCount?.count || 0,
          comments: commentCount?.count || 0,
          likes: likeCount?.count || 0,
          remixes: remixCount?.count || 0,
        },
      };
    }));

    return json({ posts, mode, limit, offset });
  } catch (error) {
    return json(
      {
        error: "Failed to fetch posts",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
};

const createPost: Handler = async (_req) => {
  // TODO: Create App or Report post
  return json({ ok: false, todo: "create post not implemented" }, 501);
};

