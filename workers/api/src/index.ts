// Cloudflare Worker API skeleton for Vibecodr
// Routes documented in SITEMAP.md. Each handler returns 501 with TODOs.

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ALLOWLIST_HOSTS: string; // JSON string
}

type Handler = (req: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>) => Promise<Response>;

const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  { method: "POST", pattern: /^\/import\/zip$/, handler: importZip },
  { method: "POST", pattern: /^\/capsules\/(\w+)\/publish$/, handler: publishCapsule },
  { method: "GET", pattern: /^\/capsules\/(\w+)\/manifest$/, handler: getManifest },
  { method: "POST", pattern: /^\/runs\/(\w+)\/logs$/, handler: appendRunLogs },
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

// Handlers (stubs)
const importZip: Handler = async (req) => {
  // TODO: Accept multipart ZIP, enqueue build, emit draft capsule
  return json({ ok: false, todo: "import zip not implemented" }, 501);
};

const publishCapsule: Handler = async (_req, _env, _ctx, params) => {
  // TODO: Validate manifest and assets in R2; create immutable record
  return json({ ok: false, capsuleId: params.p1, todo: "publish not implemented" }, 501);
};

const getManifest: Handler = async (_req, _env, _ctx, params) => {
  // TODO: Read manifest JSON from R2 or D1 by capsule id
  return json({ ok: false, capsuleId: params.p1, todo: "manifest not implemented" }, 501);
};

const appendRunLogs: Handler = async (_req, _env, _ctx, params) => {
  // TODO: Append logs with sampling; associate to run id
  return json({ ok: false, runId: params.p1, todo: "logs not implemented" }, 501);
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

