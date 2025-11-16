// Network proxy with allowlist enforcement and rate limiting
// References: research-sandbox-and-runner.md (Capability Model)

import type { Handler } from "../index";
import { requireUser } from "../auth";
import { requireCapsuleManifest } from "../capsule-manifest";

interface RateLimitState {
  count: number;
  resetAt: number;
}

// In-memory rate limit store (in production, use Durable Objects or KV)
const rateLimits = new Map<string, RateLimitState>();

// Rate limit: 100 requests per minute per capsule/host combination
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 100;

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init
  });
}

/**
 * Check if a URL is allowed by the allowlist
 */
function isHostAllowed(url: string, allowlist: string[]): boolean {
  try {
    const urlObj = new URL(url);
    const host = urlObj.hostname;

    // Check exact match or wildcard subdomain match
    return allowlist.some((allowed) => {
      // Exact match
      if (allowed === host) return true;

      // Wildcard subdomain (e.g., "*.example.com" matches "api.example.com")
      if (allowed.startsWith("*.")) {
        const baseDomain = allowed.slice(2);
        return host === baseDomain || host.endsWith(`.${baseDomain}`);
      }

      return false;
    });
  } catch {
    return false;
  }
}

/**
 * Check rate limit for capsule/host combination
 */
function checkRateLimit(capsuleId: string, host: string): { allowed: boolean; resetAt?: number; remaining?: number } {
  const key = `${capsuleId}:${host}`;
  const now = Date.now();

  const state = rateLimits.get(key);

  // No previous requests or window expired
  if (!state || now >= state.resetAt) {
    rateLimits.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  // Within rate limit
  if (state.count < RATE_LIMIT_MAX_REQUESTS) {
    state.count++;
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - state.count, resetAt: state.resetAt };
  }

  // Rate limit exceeded
  return { allowed: false, resetAt: state.resetAt };
}

/**
 * GET /proxy?url=...&capsuleId=...
 * Proxy network requests with allowlist enforcement and rate limiting
 *
 * Security features:
 * - Validates URL against capsule's manifest allowlist
 * - Rate limits per capsule/host (100 req/min)
 * - Blocks cross-origin cookies
 * - Strips sensitive headers
 * - Adds CORS headers
 */
export const netProxy: Handler = async (req, env) => {
  const url = new URL(req.url);
  const targetUrl = url.searchParams.get("url");
  const capsuleId = url.searchParams.get("capsuleId");

  if (!targetUrl) {
    return json({ error: "Missing url parameter" }, 400);
  }

  if (!capsuleId) {
    return json({ error: "Missing capsuleId parameter" }, 400);
  }

  try {
    // Validate URL format
    let targetUrlObj: URL;
    try {
      targetUrlObj = new URL(targetUrl);
    } catch {
      return json({ error: "Invalid URL format" }, 400);
    }

    // Only allow HTTP/HTTPS
    if (!["http:", "https:"].includes(targetUrlObj.protocol)) {
      return json({ error: "Only HTTP and HTTPS protocols are allowed" }, 400);
    }

    // Fetch capsule manifest to get allowlist
    const capsule = await env.DB.prepare(
      "SELECT manifest_json FROM capsules WHERE id = ?"
    ).bind(capsuleId).first();

    if (!capsule) {
      return json({ error: "Capsule not found" }, 404);
    }

    const manifest = requireCapsuleManifest(capsule.manifest_json, {
      source: "proxyAllowlist",
      capsuleId,
    });
    // Network access is currently disabled until premium VM tiers launch
    const allowlist: string[] = [];

    // Check if host is allowed
    if (!isHostAllowed(targetUrl, allowlist)) {
      return json({
        error: "Host not in allowlist",
        host: targetUrlObj.hostname,
        allowlist,
      }, 403);
    }

    // Check rate limit
    const rateLimitResult = checkRateLimit(capsuleId, targetUrlObj.hostname);
    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.resetAt! - Date.now()) / 1000);
      return json(
        { error: "Rate limit exceeded", retryAfter },
        429,
        {
          headers: {
            "Retry-After": retryAfter.toString(),
            "X-RateLimit-Limit": RATE_LIMIT_MAX_REQUESTS.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": Math.floor(rateLimitResult.resetAt! / 1000).toString(),
          },
        }
      );
    }

    // Make the proxied request
    const proxyHeaders = new Headers();

    // Copy safe headers from original request
    const allowedHeaders = ["accept", "accept-language", "content-type", "user-agent"];
    req.headers.forEach((value, key) => {
      if (allowedHeaders.includes(key.toLowerCase())) {
        proxyHeaders.set(key, value);
      }
    });

    // Add proxy identification header
    proxyHeaders.set("X-Forwarded-By", "Vibecodr-Proxy");

    const proxyResponse = await fetch(targetUrl, {
      method: req.method,
      headers: proxyHeaders,
      body: req.method !== "GET" && req.method !== "HEAD" ? await req.arrayBuffer() : undefined,
    });

    // Create response with CORS headers
    const responseHeaders = new Headers();

    // Copy safe response headers
    const safeResponseHeaders = [
      "content-type",
      "content-length",
      "cache-control",
      "expires",
      "last-modified",
      "etag",
    ];

    proxyResponse.headers.forEach((value, key) => {
      if (safeResponseHeaders.includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    // Add CORS headers
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "Content-Type");

    // Add rate limit headers
    responseHeaders.set("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS.toString());
    responseHeaders.set("X-RateLimit-Remaining", rateLimitResult.remaining!.toString());
    responseHeaders.set("X-RateLimit-Reset", Math.floor(rateLimitResult.resetAt! / 1000).toString());

    // Strip cookies (security: block cross-origin cookies)
    responseHeaders.delete("set-cookie");

    return new Response(proxyResponse.body, {
      status: proxyResponse.status,
      statusText: proxyResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return json({
      error: "Proxy request failed",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
};
