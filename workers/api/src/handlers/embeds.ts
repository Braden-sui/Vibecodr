// Embed and SEO handlers (Open Graph, oEmbed)
// References: checklist.mdx Section 12 (Sharing, Embeds, and SEO)

import type { Env, Handler } from "../types";
import { checkPublicRateLimit, getClientIp } from "../rateLimit";
import { generateNonce } from "../security/nonce";
import { json } from "../lib/responses";

type PostSchemaInfo = { hasVisibility: boolean; hasQuarantined: boolean };
let cachedPostSchemaInfo: PostSchemaInfo | null = null;

type EmbeddablePostRow = {
  id: string;
  title: string;
  description: string | null;
  author_handle: string;
  author_name: string | null;
  visibility: string | null;
  quarantined: number | null;
  cover_key: string | null;
  capsule_id: string | null;
  author_suspended: number | null;
  author_shadow_banned: number | null;
};

const EMBED_DEFAULT_WIDTH = 960;
const EMBED_DEFAULT_HEIGHT = 540;
const EMBED_MIN_WIDTH = 320;
const EMBED_MAX_WIDTH = 1200;
const EMBED_MIN_HEIGHT = 200;
const EMBED_MAX_HEIGHT = 900;
const OEMBED_RATE_LIMIT = 60;
const EMBED_RATE_LIMIT = 120;
export const EMBED_IFRAME_SANDBOX = "allow-scripts";
export const EMBED_IFRAME_ALLOW =
  "accelerometer 'none'; autoplay 'none'; camera 'none'; geolocation 'none'; gyroscope 'none'; microphone 'none'; payment 'none'; usb 'none'";
export const EMBED_PERMISSIONS_POLICY_HEADER =
  "accelerometer=(); autoplay=(); camera=(); display-capture=(); encrypted-media=(); fullscreen=(self); geolocation=(); gyroscope=(); microphone=(); midi=(); payment=(); usb=()";

function buildEmbedContentSecurityPolicy(styleNonce?: string): string {
  const styleSrc = ["'self'"];
  if (styleNonce) {
    styleSrc.push(`'nonce-${styleNonce}'`);
  }

  return [
    "default-src 'none'",
    "base-uri 'none'",
    "frame-ancestors *",
    `style-src ${styleSrc.join(" ")}`,
    "img-src 'self' data:",
    "frame-src 'self'",
    "script-src 'none'",
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
  ].join("; ");
}

async function getPostSchemaInfo(env: Env): Promise<PostSchemaInfo> {
  if (cachedPostSchemaInfo) return cachedPostSchemaInfo;
  try {
    const { results } = await env.DB.prepare(`PRAGMA table_info(posts)`).all();
    const columns = Array.isArray(results) ? results.map((r: any) => String(r?.name || "").toLowerCase()) : [];
    const hasVisibility = columns.includes("visibility");
    const hasQuarantined = columns.includes("quarantined");
    cachedPostSchemaInfo = { hasVisibility, hasQuarantined };
    return cachedPostSchemaInfo;
  } catch (error) {
    console.error("E-VIBECODR-0605 post schema introspection failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    cachedPostSchemaInfo = { hasVisibility: true, hasQuarantined: true };
    return cachedPostSchemaInfo;
  }
}

async function fetchEmbeddablePost(env: Env, postId: string): Promise<EmbeddablePostRow | null> {
  const schemaInfo = await getPostSchemaInfo(env);
  const visibilityCol = schemaInfo.hasVisibility ? "p.visibility" : "'public' as visibility";
  const quarantineCol = schemaInfo.hasQuarantined ? "p.quarantined" : "0 as quarantined";

  try {
    const { results } = await env.DB.prepare(
      `
      SELECT
        p.id,
        p.title,
        p.description,
        p.cover_key,
        p.capsule_id,
        ${visibilityCol} as visibility,
        ${quarantineCol} as quarantined,
        u.handle as author_handle,
        u.name as author_name,
        u.is_suspended as author_suspended,
        u.shadow_banned as author_shadow_banned
      FROM posts p
      INNER JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
      LIMIT 1
    `
    )
      .bind(postId)
      .all<EmbeddablePostRow>();

    const row = results && (results[0] as EmbeddablePostRow | undefined);
    return row ?? null;
  } catch (error) {
    console.error("E-VIBECODR-0606 embed post fetch failed", {
      postId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function isEmbeddablePost(row: EmbeddablePostRow | null): row is EmbeddablePostRow {
  if (!row) return false;
  const visibility = (row.visibility || "public").toLowerCase();
  const quarantined = Number(row.quarantined || 0);
  const isSuspended = Number(row.author_suspended || 0) === 1;
  const isShadowBanned = Number(row.author_shadow_banned || 0) === 1;

  if (isSuspended || isShadowBanned) return false;
  if (quarantined === 1) return false;
  if (visibility === "private") return false;
  return true;
}

function clampDimension(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function resolveEmbedDimensions(maxwidth?: number, maxheight?: number): { width: number; height: number } {
  const width = clampDimension(maxwidth ?? EMBED_DEFAULT_WIDTH, EMBED_MIN_WIDTH, EMBED_MAX_WIDTH, EMBED_DEFAULT_WIDTH);
  const targetHeight = Math.round((width * 9) / 16);
  const height = clampDimension(
    maxheight ?? targetHeight,
    EMBED_MIN_HEIGHT,
    EMBED_MAX_HEIGHT,
    maxheight ? maxheight : targetHeight
  );
  return { width, height };
}

function buildRateLimitHeaders(limit: number, rate: { remaining?: number; resetAt?: number }) {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(0, rate.remaining ?? 0)),
  };
  if (rate.resetAt) {
    headers["Retry-After"] = Math.max(0, Math.ceil((rate.resetAt - Date.now()) / 1000)).toString();
    headers["X-RateLimit-Reset"] = Math.floor(rate.resetAt / 1000).toString();
  }
  return headers;
}

function parsePostIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && (parts[0] === "player" || parts[0] === "e" || parts[0] === "post")) {
    return parts[1] || null;
  }
  return null;
}

/**
 * GET /oembed?url=...&format=json
 * oEmbed endpoint for post embeds
 *
 * Returns embed HTML with iframe, dimensions, thumbnail_url
 * Spec: https://oembed.com/
 */
export const oEmbedHandler: Handler = async (req, env) => {
  const url = new URL(req.url);
  const targetUrl = url.searchParams.get("url");
  const format = (url.searchParams.get("format") || "json").toLowerCase();
  const maxwidth = Number(url.searchParams.get("maxwidth") || "");
  const maxheight = Number(url.searchParams.get("maxheight") || "");

  if (!targetUrl) {
    return json({ error: "E-VIBECODR-0607 missing url", message: "url parameter is required" }, 400);
  }

  if (format !== "json") {
    return json({ error: "E-VIBECODR-0608 invalid format", message: "Only JSON format is supported" }, 400);
  }

  if (targetUrl.length > 2048) {
    return json({ error: "E-VIBECODR-0609 invalid url", message: "url is too long" }, 400);
  }

  const clientIp = getClientIp(req);
  const rate = await checkPublicRateLimit(env, `oembed:${clientIp ?? "unknown"}`, OEMBED_RATE_LIMIT);
  if (!rate.allowed) {
    return json(
      { error: "Rate limit exceeded", code: "E-VIBECODR-0313", scope: "oembed" },
      429,
      {
        headers: buildRateLimitHeaders(OEMBED_RATE_LIMIT, rate),
      }
    );
  }

  try {
    const urlObj = new URL(targetUrl);
    if (!["http:", "https:"].includes(urlObj.protocol)) {
      return json({ error: "E-VIBECODR-0610 invalid protocol", message: "url must be http(s)" }, 400);
    }

    const postId = parsePostIdFromPath(urlObj.pathname);
    if (!postId) {
      return json({ error: "E-VIBECODR-0611 invalid target", message: "url must point to /player/:id, /post/:id, or /e/:id" }, 400);
    }

    const post = await fetchEmbeddablePost(env, postId);
    if (!isEmbeddablePost(post)) {
      return json({ error: "E-VIBECODR-0612 not embeddable", message: "Post not found or not embeddable" }, 404);
    }

    const { width, height } = resolveEmbedDimensions(maxwidth, maxheight);

    // Generate embed HTML
    const providerOrigin = urlObj.origin;
    const embedUrl = `${providerOrigin}/e/${encodeURIComponent(postId)}`;
    const playerUrl = `${providerOrigin}/player/${encodeURIComponent(postId)}`;
    const thumbnailUrl = `${providerOrigin}/api/og-image/${encodeURIComponent(postId)}`;
    const title = post.title || "Vibecodr vibe";
    const authorHandle = post.author_handle || "";
    const authorName = post.author_name || (authorHandle ? `@${authorHandle}` : "Unknown creator");
    const authorUrl = authorHandle ? `${providerOrigin}/u/${authorHandle}` : providerOrigin;

    const embedHtml = `<iframe src="${embedUrl}" width="${width}" height="${height}" title="${escapeHtml(title)}" loading="lazy" style="border:0; border-radius:12px; overflow:hidden;" frameborder="0" sandbox="${EMBED_IFRAME_SANDBOX}" allow="${EMBED_IFRAME_ALLOW}" referrerpolicy="no-referrer" allowfullscreen></iframe>`;

    // oEmbed response
    return json({
      version: "1.0",
      type: "rich",
      provider_name: "Vibecodr",
      provider_url: providerOrigin,
      title,
      author_name: authorName,
      author_url: authorUrl,
      url: playerUrl,
      html: embedHtml,
      width,
      height,
      thumbnail_url: thumbnailUrl,
      thumbnail_width: 1200,
      thumbnail_height: 630,
      cache_age: 3600,
    });
  } catch (error) {
    return json({
      error: "E-VIBECODR-0613 oembed failure",
      message: "Failed to generate oEmbed response",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
};

/**
 * GET /e/:postId
 * Embed iframe endpoint with strict sandbox
 *
 * Returns HTML page with embedded player
 */
export const embedIframeHandler: Handler = async (req, env, ctx, params) => {
  const postId = params.p1;

  const clientIp = getClientIp(req);
  const rate = await checkPublicRateLimit(env, `embed:${clientIp ?? "unknown"}`, EMBED_RATE_LIMIT);
  if (!rate.allowed) {
    const rateHeaders = buildRateLimitHeaders(EMBED_RATE_LIMIT, rate);
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded", code: "E-VIBECODR-0315", scope: "embed" }),
      {
        status: 429,
        headers: { "content-type": "application/json", ...rateHeaders },
      }
    );
  }

  try {
    const post = await fetchEmbeddablePost(env, postId);
    if (!isEmbeddablePost(post)) {
      return new Response("Post not found", { status: 404 });
    }

    const baseOrigin = new URL(req.url).origin;
    const playerUrl = `${baseOrigin}/player/${encodeURIComponent(postId)}`;
    const ogImageUrl = `${baseOrigin}/api/og-image/${encodeURIComponent(postId)}`;
    const oEmbedUrl = `${baseOrigin}/api/oembed?url=${encodeURIComponent(playerUrl)}&format=json`;
    const title = post.title || "Vibecodr vibe";
    const authorHandle = (post.author_handle || "").trim();
    const authorName = (post.author_name || "").trim();
    const author = authorName || (authorHandle ? `@${authorHandle}` : "Unknown creator");
    const description =
      (post.description || "").trim().slice(0, 280) || `Playable capsule by ${author}`;
    const styleNonce = generateNonce();
    const embedCsp = buildEmbedContentSecurityPolicy(styleNonce);

    // Generate minimal HTML with embedded player
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Vibecodr</title>
  <link rel="canonical" href="${playerUrl}">
  <link rel="alternate" type="application/json+oembed" href="${oEmbedUrl}" title="${escapeHtml(title)}">
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="video.other">
  <meta property="og:site_name" content="Vibecodr">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${playerUrl}">
  <meta property="og:image" content="${ogImageUrl}">
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:title" content="${escapeHtml(title)}">
  <meta property="twitter:description" content="${escapeHtml(description)}">
  <meta property="twitter:image" content="${ogImageUrl}">
  <meta name="author" content="${escapeHtml(author)}">
  <style nonce="${styleNonce}">
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at 10% 20%, rgba(255,255,255,0.12), transparent 25%), #0f172a;
      color: #e2e8f0;
    }
    .container {
      max-width: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      background: rgba(15,23,42,0.92);
      border-bottom: 1px solid rgba(148,163,184,0.4);
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .header h1 {
      font-size: 15px;
      font-weight: 600;
      color: #e2e8f0;
      margin: 0;
      line-height: 1.4;
    }
    .header a {
      font-size: 13px;
      color: #93c5fd;
      text-decoration: none;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px solid rgba(148,163,184,0.5);
      border-radius: 10px;
      background: rgba(255,255,255,0.04);
    }
    .header a:hover {
      border-color: rgba(148,163,184,0.8);
      background: rgba(255,255,255,0.08);
    }
    .player {
      flex: 1;
      background: #0b1221;
      border-top: 1px solid rgba(148,163,184,0.25);
    }
    .player iframe {
      width: 100%;
      height: 100%;
      border: none;
      border-radius: 12px;
      overflow: hidden;
    }
    .author-meta {
      font-size: 12px;
      color: #cbd5e1;
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="author-meta">by ${escapeHtml(author)}</p>
      </div>
      <a href="${playerUrl}" target="_blank" rel="noopener noreferrer">Open in Vibecodr</a>
    </div>
    <div class="player">
      <iframe
        src="${playerUrl}"
        title="${escapeHtml(title)}"
        sandbox="${EMBED_IFRAME_SANDBOX}"
        allow="${EMBED_IFRAME_ALLOW}"
        referrerpolicy="no-referrer"
        loading="lazy"
        allowfullscreen
      ></iframe>
    </div>
  </div>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=600",
        "Content-Security-Policy": embedCsp,
        "Permissions-Policy": EMBED_PERMISSIONS_POLICY_HEADER,
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Content-Type-Options": "nosniff",
        ...buildRateLimitHeaders(EMBED_RATE_LIMIT, rate),
      },
    });
  } catch (error) {
    return new Response("Internal server error", { status: 500 });
  }
};

/**
 * Helper to escape HTML
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * GET /og-image/:postId
 * Generate Open Graph image for post (placeholder for now)
 *
 * In production, this would use @vercel/og or similar to generate
 * a branded image with post title, author, and stats
 */
export const ogImageHandler: Handler = async (req, env, ctx, params) => {
  const postId = params.p1;

  type OgImageRow = {
    title: string;
    author_handle: string;
  };

  const clientIp = getClientIp(req);
  const rate = await checkPublicRateLimit(env, `og:${clientIp ?? "unknown"}`, 60);
  if (!rate.allowed) {
    const retryAfter = rate.resetAt ? Math.ceil((rate.resetAt - Date.now()) / 1000) : 60;
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded", code: "E-VIBECODR-0314", scope: "og-image" }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "Retry-After": retryAfter.toString(),
          "X-RateLimit-Limit": "60",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": rate.resetAt ? Math.floor(rate.resetAt / 1000).toString() : "",
        },
      }
    );
  }

  try {
    // Fetch post details
    const post = (await env.DB.prepare(`
      SELECT p.title, u.handle as author_handle
      FROM posts p
      INNER JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `).bind(postId).first()) as OgImageRow | null;

    if (!post) {
      return new Response("Post not found", { status: 404 });
    }

    // TODO: Generate actual image using @vercel/og or canvas API
    // For now, return a placeholder SVG
    const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#grad)"/>
  <text x="60" y="100" font-family="system-ui, sans-serif" font-size="60" font-weight="bold" fill="white">
    Vibecodr
  </text>
  <text x="60" y="350" font-family="system-ui, sans-serif" font-size="48" font-weight="600" fill="white">
    ${escapeHtml(post.title.slice(0, 50))}${post.title.length > 50 ? "..." : ""}
  </text>
  <text x="60" y="550" font-family="system-ui, sans-serif" font-size="32" fill="rgba(255,255,255,0.8)">
    by @${escapeHtml(post.author_handle)}
  </text>
</svg>`;

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return new Response("Internal server error", { status: 500 });
  }
};
