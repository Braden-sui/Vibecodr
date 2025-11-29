// Network proxy with allowlist enforcement and rate limiting
// References: research-sandbox-and-runner.md (Capability Model)

import type { Env, Handler } from "../types";
import { requireCapsuleManifest } from "../capsule-manifest";
import { requireUser } from "../auth";
import { getUserPlan, Plan } from "../storage/quotas";
import { json } from "../lib/responses";
import { hashToShard } from "../lib/sharding";

interface RateLimitState {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 100;
const RATE_LIMIT_KEY_PREFIX = "proxy:rate:";
let rateLimitStorageMisconfiguredWarned = false;
const inMemoryRateLimitStore = new Map<string, RateLimitState>();
const RATE_LIMIT_TABLE = "proxy_rate_limits";
const RATE_LIMIT_WINDOW_SEC = 60;
const USER_RATE_LIMITS: Record<Plan, number> = {
  [Plan.FREE]: 15,
  [Plan.CREATOR]: 60,
  [Plan.PRO]: 120,
  [Plan.TEAM]: 200,
};
const IP_RATE_LIMIT = 120;
let rateLimitTableInitialized = false;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const DEFAULT_ALLOWED_PORTS = new Set([80, 443]);
const LOCALHOST_NAMES = new Set(["localhost", "localhost."]);

const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const BLOCKED_IPV4_RANGES = [
  { start: ipToNumber([10, 0, 0, 0]), end: ipToNumber([10, 255, 255, 255]), reason: "RFC1918 10/8" },
  { start: ipToNumber([172, 16, 0, 0]), end: ipToNumber([172, 31, 255, 255]), reason: "RFC1918 172.16/12" },
  { start: ipToNumber([192, 168, 0, 0]), end: ipToNumber([192, 168, 255, 255]), reason: "RFC1918 192.168/16" },
  { start: ipToNumber([127, 0, 0, 0]), end: ipToNumber([127, 255, 255, 255]), reason: "Loopback 127/8" },
  { start: ipToNumber([169, 254, 0, 0]), end: ipToNumber([169, 254, 255, 255]), reason: "Link-local 169.254/16" },
  { start: ipToNumber([100, 64, 0, 0]), end: ipToNumber([100, 127, 255, 255]), reason: "CGNAT 100.64/10" },
];

interface AllowlistRule {
  hostname: string;
  port?: number;
  wildcard: boolean;
}

const ERROR_PROXY_ALLOWLIST_PARSE = "E-VIBECODR-0301";
const ERROR_PROXY_DISABLED = "E-VIBECODR-0300";
const ERROR_PROXY_HOST_BLOCKED = "E-VIBECODR-0302";
const ERROR_PROXY_RATE_LIMIT_STORAGE = "E-VIBECODR-0303";
const ERROR_PROXY_RATE_LIMIT_STORAGE_MISCONFIG = "E-VIBECODR-0304";

/**
 * Check if a URL is allowed by the allowlist
 */
export function isHostAllowed(targetUrl: URL, allowlist: string[]): boolean {
  const hostname = normalizeHostname(targetUrl.hostname);
  if (!hostname) {
    return false;
  }

  const port = getEffectivePort(targetUrl);

  return allowlist.some((raw) => {
    const rule = parseAllowlistRule(raw);
    if (!rule) {
      return false;
    }

    const matchesHost = rule.wildcard
      ? hostname === rule.hostname || hostname.endsWith(`.${rule.hostname}`)
      : hostname === rule.hostname;

    if (!matchesHost) {
      return false;
    }

    if (rule.port === undefined) {
      return DEFAULT_ALLOWED_PORTS.has(port);
    }

    return rule.port === port;
  });
}

export function isAllowedProtocol(protocol: string): boolean {
  return ALLOWED_PROTOCOLS.has(protocol);
}

export function getBlockedAddressReason(hostnameInput: string): { message: string; code: string } | null {
  const hostname = normalizeHostname(hostnameInput);
  if (!hostname) {
    return { message: "Invalid host", code: ERROR_PROXY_HOST_BLOCKED };
  }

  if (LOCALHOST_NAMES.has(hostname)) {
    return { message: "Localhost targets are not allowed", code: ERROR_PROXY_HOST_BLOCKED };
  }

  const ipv4Segments = parseIpv4Segments(hostname);
  if (ipv4Segments) {
    const asNumber = ipToNumber(ipv4Segments);
    const range = BLOCKED_IPV4_RANGES.find((item) => asNumber >= item.start && asNumber <= item.end);
    if (range) {
      return { message: `${range.reason} addresses are blocked`, code: ERROR_PROXY_HOST_BLOCKED };
    }

    return { message: "Direct IP addresses are blocked", code: ERROR_PROXY_HOST_BLOCKED };
  }

  if (hostname.includes(":")) {
    return { message: "IPv6 literals are blocked", code: ERROR_PROXY_HOST_BLOCKED };
  }

  return null;
}

/**
 * Check rate limit for capsule/host combination using KV storage (fallback to in-memory for dev)
 */
async function checkRateLimit(env: Env, capsuleId: string, host: string): Promise<{ allowed: boolean; resetAt?: number; remaining?: number }> {
  const key = `${RATE_LIMIT_KEY_PREFIX}${capsuleId}:${host}`;

  const doResult =
    (await checkRateLimitDo(env, key, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SEC)) ??
    null;
  if (doResult) {
    return {
      allowed: doResult.allowed,
      remaining: doResult.remaining,
      resetAt: doResult.resetAt,
    };
  }

  const d1Result = await checkD1RateLimit(env, key, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SEC);
  if (!d1Result.allowed) {
    return { allowed: false, remaining: d1Result.remaining, resetAt: d1Result.resetAt };
  }

  // Final fallback to KV/in-memory to avoid dropping requests when D1/DO are unavailable.
  const now = Date.now();
  const state = await readRateLimitState(env, key);

  if (!state || now >= state.resetAt) {
    const nextState: RateLimitState = {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    };
    await writeRateLimitState(env, key, nextState);
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetAt: nextState.resetAt,
    };
  }

  if (state.count < RATE_LIMIT_MAX_REQUESTS) {
    const nextState: RateLimitState = {
      count: state.count + 1,
      resetAt: state.resetAt,
    };
    await writeRateLimitState(env, key, nextState);
    return {
      allowed: true,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - nextState.count),
      resetAt: nextState.resetAt,
    };
  }

  return { allowed: false, resetAt: state.resetAt };
}

type DbRateLimitResult = { allowed: boolean; remaining?: number; resetAt?: number };

async function ensureRateLimitTable(env: Env) {
  if (rateLimitTableInitialized) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ${RATE_LIMIT_TABLE} (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      )`
    ).run();
    rateLimitTableInitialized = true;
  } catch (err) {
    console.error("E-VIBECODR-0307 proxy rate limit table init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function checkD1RateLimit(env: Env, key: string, limit: number, windowSec = RATE_LIMIT_WINDOW_SEC): Promise<DbRateLimitResult> {
  if (limit <= 0) {
    return { allowed: false, remaining: 0, resetAt: Date.now() + windowSec * 1000 };
  }

  try {
    await ensureRateLimitTable(env);
    const nowSec = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare(`SELECT count, reset_at FROM ${RATE_LIMIT_TABLE} WHERE key = ? LIMIT 1`)
      .bind(key)
      .first<{ count?: number; reset_at?: number }>();

    if (!row || typeof row.reset_at !== "number" || nowSec >= row.reset_at) {
      const nextReset = nowSec + windowSec;
      await env.DB.prepare(
        `INSERT INTO ${RATE_LIMIT_TABLE} (key, count, reset_at)
         VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at`
      )
        .bind(key, nextReset)
        .run();
      return { allowed: true, remaining: Math.max(0, limit - 1), resetAt: nextReset * 1000 };
    }

    const currentCount = typeof row.count === "number" ? row.count : 0;
    if (currentCount >= limit) {
      return { allowed: false, remaining: 0, resetAt: row.reset_at * 1000 };
    }

    const nextCount = currentCount + 1;
    await env.DB.prepare(`UPDATE ${RATE_LIMIT_TABLE} SET count = ? WHERE key = ?`).bind(nextCount, key).run();
    return { allowed: true, remaining: Math.max(0, limit - nextCount), resetAt: row.reset_at * 1000 };
  } catch (err) {
    // SAFETY: Fail-closed on rate limit errors to prevent abuse during DB outages.
    console.error("E-VIBECODR-0308 proxy D1 rate limit check failed (fail-closed)", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: false, remaining: 0, resetAt: Date.now() + windowSec * 1000 };
  }
}

async function checkRateLimitDo(
  env: Env,
  key: string,
  limit: number,
  windowSec = RATE_LIMIT_WINDOW_SEC
): Promise<DbRateLimitResult | null> {
  if (!env.RATE_LIMIT_SHARD) return null;
  const shardId = env.RATE_LIMIT_SHARD.idFromName(hashToShard(key));
  const stub = env.RATE_LIMIT_SHARD.get(shardId);
  try {
    const res = await stub.fetch("https://do/rate-limit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, limit, windowSec }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { allowed: boolean; remaining: number; resetMs: number };
    return { allowed: data.allowed, remaining: data.remaining, resetAt: data.resetMs };
  } catch (err) {
    console.error("E-VIBECODR-0310 rate limit DO failed (fallback to D1)", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function getClientIp(req: Request): string | null {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim()) return cfIp.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || null;
  }

  return null;
}

/**
 * GET /proxy?url=...&capsuleId=...
 * Proxy network requests with allowlist enforcement and rate limiting
 *
 * Security features:
 * - Requires authenticated user (via requireUser)
 * - Validates URL against capsule's manifest allowlist
 * - Ensures the requested capsule belongs to the caller
 * - Rate limits per capsule/host (100 req/min)
 * - Blocks cross-origin cookies
 * - Strips sensitive headers
 * - Adds CORS headers
 */
export const netProxy: Handler = requireUser(async (req, env, _ctx, _params, userId) => {
  if (env.NET_PROXY_ENABLED !== "true") {
    return json({ error: "Network proxy is disabled for client-static capsules", code: ERROR_PROXY_DISABLED }, 403);
  }

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

    if (!isAllowedProtocol(targetUrlObj.protocol)) {
      return json({ error: "Only HTTP and HTTPS protocols are allowed" }, 400);
    }

    const normalizedHost = normalizeHostname(targetUrlObj.hostname);
    if (!normalizedHost) {
      return json({ error: "Invalid host" }, 400);
    }

    const blockedReason = getBlockedAddressReason(targetUrlObj.hostname);
    if (blockedReason) {
      return json({ error: blockedReason.message, host: targetUrlObj.hostname, errorCode: blockedReason.code }, 403);
    }

    // Fetch capsule manifest to get allowlist and enforce ownership
    const capsule = await env.DB.prepare(
      "SELECT owner_id, manifest_json FROM capsules WHERE id = ?"
    ).bind(capsuleId).first();

    if (!capsule) {
      return json({ error: "Capsule not found" }, 404);
    }

    if (capsule.owner_id !== userId) {
      return json({ error: "Forbidden" }, 403);
    }

    const plan = await getUserPlan(capsule.owner_id, env);
    const clientIp = getClientIp(req);

    if (plan === Plan.FREE && String(env.NET_PROXY_FREE_ENABLED || "").trim().toLowerCase() !== "true") {
      return json({ error: "Network proxy is disabled for free plan", code: "E-VIBECODR-0305" }, 403);
    }

    const userRate =
      (await checkRateLimitDo(env, `user:${capsule.owner_id}`, USER_RATE_LIMITS[plan])) ??
      (await checkD1RateLimit(env, `user:${capsule.owner_id}`, USER_RATE_LIMITS[plan]));
    if (!userRate.allowed) {
      return rateLimitExceeded("user", userRate, USER_RATE_LIMITS[plan]);
    }

    let ipRate: DbRateLimitResult | null = null;
    if (clientIp) {
      ipRate =
        (await checkRateLimitDo(env, `ip:${clientIp}`, IP_RATE_LIMIT)) ??
        (await checkD1RateLimit(env, `ip:${clientIp}`, IP_RATE_LIMIT));
      if (!ipRate.allowed) {
        return rateLimitExceeded("ip", ipRate, IP_RATE_LIMIT);
      }
    }

    const manifest = requireCapsuleManifest(capsule.manifest_json, {
      source: "proxyAllowlist",
      capsuleId,
    });
    const allowlist = buildAllowlist(manifest.capabilities?.net, env.ALLOWLIST_HOSTS);

    if (allowlist.length === 0) {
      return json({ error: "No hosts are allowed for this capsule", code: "E-VIBECODR-0306" }, 403);
    }

    if (!isHostAllowed(targetUrlObj, allowlist)) {
      return json({
        error: "Host not in allowlist",
        host: targetUrlObj.hostname,
        allowlist,
      }, 403);
    }

    // Check rate limit
    const rateLimitResult = await checkRateLimit(env, capsuleId, normalizedHost);
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
    responseHeaders.set("X-RateLimit-User-Limit", USER_RATE_LIMITS[plan].toString());
    responseHeaders.set("X-RateLimit-User-Remaining", (userRate.remaining ?? 0).toString());
    if (ipRate) {
      responseHeaders.set("X-RateLimit-IP-Limit", IP_RATE_LIMIT.toString());
      responseHeaders.set("X-RateLimit-IP-Remaining", (ipRate.remaining ?? 0).toString());
    }

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
});

function buildAllowlist(manifestHosts: string[] | undefined, envAllowlistJson: string): string[] {
  const envHosts = parseEnvAllowlist(envAllowlistJson).map(canonicalizeAllowlistEntry).filter((v): v is string => Boolean(v));
  const envSet = new Set(envHosts);
  const manifestEntries =
    manifestHosts
      ?.map(canonicalizeAllowlistEntry)
      .filter((v): v is string => Boolean(v)) ?? [];

  if (envSet.size === 0) {
    return [];
  }

  if (manifestEntries.length === 0) {
    return Array.from(envSet);
  }

  return manifestEntries.filter((entry) => envSet.has(entry));
}

function parseEnvAllowlist(rawAllowlist: string): string[] {
  if (!rawAllowlist) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawAllowlist);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim());
    }

    return [];
  } catch (error) {
    console.error(`${ERROR_PROXY_ALLOWLIST_PARSE} global allowlist parse failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function parseAllowlistRule(entry: string): AllowlistRule | null {
  if (typeof entry !== "string") {
    return null;
  }

  let normalized = entry.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    try {
      normalized = new URL(normalized).host.toLowerCase();
    } catch {
      return null;
    }
  }

  if (normalized.includes("/")) {
    normalized = normalized.split("/")[0];
  }

  let wildcard = false;
  if (normalized.startsWith("*.")) {
    wildcard = true;
    normalized = normalized.slice(2);
  }

  let hostname = normalized;
  let port: number | undefined;

  const lastColon = hostname.lastIndexOf(":");
  if (lastColon > -1 && /^\d+$/.test(hostname.slice(lastColon + 1))) {
    port = Number(hostname.slice(lastColon + 1));
    hostname = hostname.slice(0, lastColon);
  }

  hostname = hostname.replace(/\.+$/, "");
  if (!hostname) {
    return null;
  }

  return { hostname, port, wildcard };
}

function canonicalizeAllowlistEntry(entry: string): string | null {
  const rule = parseAllowlistRule(entry);
  if (!rule) return null;
  const hostPart = rule.wildcard ? `*.${rule.hostname}` : rule.hostname;
  return typeof rule.port === "number" ? `${hostPart}:${rule.port}` : hostPart;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

function getEffectivePort(targetUrl: URL): number {
  if (targetUrl.port) {
    const parsed = Number(targetUrl.port);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return targetUrl.protocol === "https:" ? 443 : 80;
}

function parseIpv4Segments(hostname: string): number[] | null {
  if (!IPV4_REGEX.test(hostname)) {
    return null;
  }

  const segments = hostname.split(".").map((part) => Number(part));
  if (segments.length !== 4 || segments.some((segment) => Number.isNaN(segment) || segment < 0 || segment > 255)) {
    return null;
  }

  return segments;
}

function ipToNumber(parts: number[]): number {
  return (
    (((parts[0] << 24) >>> 0) + ((parts[1] & 255) << 16) + ((parts[2] & 255) << 8) + (parts[3] & 255)) >>> 0
  );
}

async function readRateLimitState(env: Env, key: string): Promise<RateLimitState | null> {
  const now = Date.now();

  if (!env.RUNTIME_MANIFEST_KV) {
    warnRateLimitStorageMisconfigured();
    return readInMemoryRateLimitState(key, now);
  }

  try {
    const raw = await env.RUNTIME_MANIFEST_KV.get(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (typeof parsed?.count === "number" && typeof parsed?.resetAt === "number") {
      return parsed as RateLimitState;
    }
  } catch (error) {
    console.error(`${ERROR_PROXY_RATE_LIMIT_STORAGE} rate limit read failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    warnRateLimitStorageMisconfigured();
    return readInMemoryRateLimitState(key, now);
  }

  return null;
}

async function writeRateLimitState(env: Env, key: string, state: RateLimitState): Promise<void> {
  if (!env.RUNTIME_MANIFEST_KV) {
    warnRateLimitStorageMisconfigured();
    writeInMemoryRateLimitState(key, state);
    return;
  }

  try {
    const ttlSeconds = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));
    await env.RUNTIME_MANIFEST_KV.put(key, JSON.stringify(state), { expirationTtl: ttlSeconds });
  } catch (error) {
    console.error(`${ERROR_PROXY_RATE_LIMIT_STORAGE} rate limit write failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    warnRateLimitStorageMisconfigured();
    writeInMemoryRateLimitState(key, state);
  }
}

function warnRateLimitStorageMisconfigured() {
  if (!rateLimitStorageMisconfiguredWarned) {
    console.error(
      `${ERROR_PROXY_RATE_LIMIT_STORAGE_MISCONFIG} proxy rate limit storage misconfigured; RUNTIME_MANIFEST_KV binding is required for net proxy. Falling back to in-memory store.`
    );
    rateLimitStorageMisconfiguredWarned = true;
  }
}

function readInMemoryRateLimitState(key: string, now: number): RateLimitState | null {
  const state = inMemoryRateLimitStore.get(key);
  if (!state) {
    return null;
  }

  if (now >= state.resetAt) {
    inMemoryRateLimitStore.delete(key);
    return null;
  }

  return state;
}

function writeInMemoryRateLimitState(key: string, state: RateLimitState): void {
  inMemoryRateLimitStore.set(key, state);
}

function rateLimitExceeded(scope: "user" | "ip", result: DbRateLimitResult, limit: number): Response {
  const retryAfter = result.resetAt ? Math.ceil((result.resetAt - Date.now()) / 1000) : RATE_LIMIT_WINDOW_SEC;
  const headers = {
    "Retry-After": retryAfter.toString(),
    "X-RateLimit-Limit": limit.toString(),
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": Math.floor((result.resetAt ?? Date.now()) / 1000).toString(),
    ...(scope === "user"
      ? {
          "X-RateLimit-User-Limit": limit.toString(),
          "X-RateLimit-User-Remaining": "0",
        }
      : {
          "X-RateLimit-IP-Limit": limit.toString(),
          "X-RateLimit-IP-Remaining": "0",
        }),
  };
  return json(
    {
      error: "Rate limit exceeded",
      scope,
    },
    429,
    { headers }
  );
}
