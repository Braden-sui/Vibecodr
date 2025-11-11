// Cloudflare Worker API skeleton for Vibecodr
// Routes documented in SITEMAP.md. Each handler returns 501 with TODOs.

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ALLOWLIST_HOSTS: string; // JSON string
}

type Handler = (req: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>) => Promise<Response>;

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  { method: "POST", pattern: /^\/manifest\/validate$/, handler: validateManifestHandler },
  { method: "POST", pattern: /^\/import\/github$/, handler: importGithub },
  { method: "POST", pattern: /^\/import\/zip$/, handler: importZip },
  { method: "POST", pattern: /^\/capsules\/(\w+)\/publish$/, handler: publishCapsule },
  { method: "GET", pattern: /^\/capsules\/(\w+)\/manifest$/, handler: getManifest },
  { method: "GET", pattern: /^\/capsules\/(\w+)\/bundle$/, handler: getCapsuleBundle },
  { method: "POST", pattern: /^\/runs\/(\w+)\/logs$/, handler: appendRunLogs },
  { method: "GET", pattern: /^\/posts$/, handler: getPosts },
  { method: "POST", pattern: /^\/posts$/, handler: createPost },
  { method: "POST", pattern: /^\/moderation\/report$/, handler: reportContent },
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

// Handlers (stubs)
const importGithub: Handler = async (req) => {
  // TODO: Accept GitHub URL, fetch repo, analyze structure
  return json({ ok: false, todo: "import github not implemented" }, 501);
};

const importZip: Handler = async (req) => {
  // TODO: Accept multipart ZIP, enqueue build, emit draft capsule
  return json({ ok: false, todo: "import zip not implemented" }, 501);
};

const publishCapsule: Handler = async (_req, _env, _ctx, params) => {
  // TODO: Validate manifest and assets in R2; create immutable record
  return json({ ok: false, capsuleId: params.p1, todo: "publish not implemented" }, 501);
};

const appendRunLogs: Handler = async (_req, _env, _ctx, params) => {
  // TODO: Append logs with sampling; associate to run id
  return json({ ok: false, runId: params.p1, todo: "logs not implemented" }, 501);
};

const getPosts: Handler = async (req, env) => {
  // GET /posts?mode=latest|following&limit=20&offset=0
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "latest";
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");

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

    if (mode === "following") {
      // TODO: Add following logic
      query += ` WHERE p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)`;
    }

    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;

    const { results } = await env.DB.prepare(query).bind(limit, offset).all();

    const posts = results?.map((row: any) => ({
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
      // TODO: Add stats from aggregated queries
      stats: {
        runs: 0,
        comments: 0,
        likes: 0,
        remixes: 0,
      },
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

const reportContent: Handler = async (_req) => {
  // TODO: Create moderation report and enqueue review
  return json({ ok: false, todo: "moderation report not implemented" }, 501);
};

const netProxy: Handler = async (req, env) => {
  // TODO: Enforce per-capsule host allowlist and rate limits.
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  if (!target) return json({ error: "missing url" }, 400);
  return json({ ok: false, target, todo: "proxy not implemented" }, 501);
};

