// Cloudflare Worker API implementation for Vibecod
// Routes documented in SITEMAP.md.

// Polyfill Node.js globals that esbuild-wasm expects but Cloudflare Workers doesn't provide
// even with nodejs_compat flag. Must be before any esbuild imports.
if (typeof globalThis.__filename === "undefined") {
  (globalThis as any).__filename = "/worker.js";
}
if (typeof globalThis.__dirname === "undefined") {
  (globalThis as any).__dirname = "/";
}

import type { Env } from "./types";
import { routes } from "./routes";
import { buildCorsContext, withCors } from "./middleware/cors";
import { json } from "./lib/responses";
import { reconcileCounters } from "./maintenance/reconcileCounters";

export type { Env, Handler } from "./types";
export { BuildCoordinator } from "./durable/BuildCoordinator";
export { ArtifactCompiler } from "./durable/ArtifactCompiler";
export { computeForYouScore, type ForYouScoreInput } from "./feed/scoring";
export { routes } from "./routes";
export { getPostById, getPosts } from "./handlers/posts";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const cors = buildCorsContext(req, env);
    if (cors.isPreflight && cors.preflightResponse) {
      return cors.preflightResponse;
    }

    const url = new URL(req.url);
    // Allow optional /api prefix when running behind Pages/Next routing
    const pathname = url.pathname.startsWith("/api/") ? url.pathname.slice(4) : url.pathname;

    for (const r of routes) {
      if (req.method !== r.method) continue;
      const match = pathname.match(r.pattern);
      if (match) {
        const params: Record<string, string> = {};
        match.slice(1).forEach((v, i) => (params[`p${i + 1}`] = v));
        try {
          const response = await r.handler(req, env, ctx, params);
          return withCors(response, cors.origin);
        } catch (e: any) {
          return withCors(json({ error: e?.message || "internal" }, 500), cors.origin);
        }
      }
    }
    return withCors(json({ error: "not found" }, 404), cors.origin);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(reconcileCounters(env));
  },
} satisfies ExportedHandler<Env>;
