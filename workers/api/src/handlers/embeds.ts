// Embed and SEO handlers (Open Graph, oEmbed)
// References: checklist.mdx Section 12 (Sharing, Embeds, and SEO)

import type { Handler } from "../index";

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init
  });
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
  const format = url.searchParams.get("format") || "json";
  const maxwidth = parseInt(url.searchParams.get("maxwidth") || "800");
  const maxheight = parseInt(url.searchParams.get("maxheight") || "600");

  if (!targetUrl) {
    return json({ error: "Missing url parameter" }, 400);
  }

  if (format !== "json") {
    return json({ error: "Only JSON format is supported" }, 400);
  }

  try {
    // Parse post ID from URL
    // Expected format: https://vibecodr.com/player/{postId} or /e/{postId}
    const urlObj = new URL(targetUrl);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);

    let postId: string | null = null;
    if (pathParts[0] === "player" && pathParts[1]) {
      postId = pathParts[1];
    } else if (pathParts[0] === "e" && pathParts[1]) {
      postId = pathParts[1];
    }

    if (!postId) {
      return json({ error: "Invalid URL format" }, 400);
    }

    // Fetch post details
    const post = await env.DB.prepare(`
      SELECT
        p.id, p.type, p.title, p.description,
        u.handle as author_handle, u.name as author_name
      FROM posts p
      INNER JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `).bind(postId).first();

    if (!post) {
      return json({ error: "Post not found" }, 404);
    }

    // Generate embed HTML
    const embedUrl = `${urlObj.origin}/e/${postId}`;
    const width = Math.min(maxwidth, 800);
    const height = Math.min(maxheight, 600);

    const embedHtml = `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;

    // oEmbed response
    return json({
      version: "1.0",
      type: "rich",
      provider_name: "Vibecodr",
      provider_url: urlObj.origin,
      title: post.title,
      author_name: post.author_name || `@${post.author_handle}`,
      author_url: `${urlObj.origin}/profile/${post.author_handle}`,
      html: embedHtml,
      width,
      height,
      thumbnail_url: `${urlObj.origin}/api/og-image/${postId}`, // TODO: Implement OG image generator
      thumbnail_width: 1200,
      thumbnail_height: 630,
    });
  } catch (error) {
    return json({
      error: "Failed to generate oEmbed response",
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

  try {
    // Fetch post details
    const post = await env.DB.prepare(`
      SELECT
        p.id, p.type, p.title, p.description, p.capsule_id,
        c.manifest_json,
        u.handle as author_handle, u.name as author_name
      FROM posts p
      INNER JOIN users u ON p.author_id = u.id
      LEFT JOIN capsules c ON p.capsule_id = c.id
      WHERE p.id = ?
    `).bind(postId).first();

    if (!post) {
      return new Response("Post not found", { status: 404 });
    }

    // Generate minimal HTML with embedded player
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(post.title)} - Vibecodr</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f5f5f5;
    }
    .container {
      max-width: 100%;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin: 0;
    }
    .header a {
      font-size: 14px;
      color: #0066cc;
      text-decoration: none;
    }
    .header a:hover {
      text-decoration: underline;
    }
    .player {
      flex: 1;
      background: white;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${escapeHtml(post.title)}</h1>
      <a href="${req.url.replace(/\/e\//, "/player/")}" target="_blank">Open in Vibecodr</a>
    </div>
    <div class="player">
      <iframe
        src="${req.url.replace(/\/e\//, "/player/")}"
        sandbox="allow-scripts allow-same-origin allow-forms"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
      ></iframe>
    </div>
  </div>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": "frame-ancestors 'self' https://*",
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

  try {
    // Fetch post details
    const post = await env.DB.prepare(`
      SELECT p.title, u.handle as author_handle
      FROM posts p
      INNER JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `).bind(postId).first();

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
