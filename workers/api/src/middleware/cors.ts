import type { Env } from "../types";

// WHY: CORS allowlist prevents unauthorized origins from calling the API.
// INVARIANT: In production, only origins in CORS_ALLOWED_ORIGINS env var are permitted.
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://vibecodr.space",
  "https://www.vibecodr.space",
  "https://vibecodr.pages.dev",
];

export type CorsContext = {
  origin: string | null;
  isPreflight: boolean;
  preflightResponse: Response | null;
};

export function parseAllowedOrigins(envValue?: string): Set<string> {
  if (!envValue) return new Set(DEFAULT_ALLOWED_ORIGINS);
  try {
    const parsed = JSON.parse(envValue);
    if (Array.isArray(parsed)) {
      const origins = parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      return new Set(origins.length > 0 ? origins : DEFAULT_ALLOWED_ORIGINS);
    }
  } catch {
    // Fall through to comma-delimited parsing
  }
  const origins = envValue.split(",").map((o) => o.trim()).filter(Boolean);
  return new Set(origins.length > 0 ? origins : DEFAULT_ALLOWED_ORIGINS);
}

export function isOriginAllowed(origin: string | null, allowedOrigins: Set<string>, isDev: boolean): boolean {
  if (!origin) return false;
  if (isDev && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
    return true;
  }
  return allowedOrigins.has(origin);
}

export function buildCorsContext(req: Request, env: Env): CorsContext {
  const origin = req.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
  // SAFETY: Detect dev mode by checking if we're on localhost.
  const isDev = req.url.includes("localhost") || req.url.includes("127.0.0.1");
  const originAllowed = isOriginAllowed(origin, allowedOrigins, isDev);
  const corsOrigin = originAllowed && origin ? origin : null;

  if (req.method === "OPTIONS") {
    return {
      origin: corsOrigin,
      isPreflight: true,
      preflightResponse: createPreflightResponse(corsOrigin),
    };
  }

  return { origin: corsOrigin, isPreflight: false, preflightResponse: null };
}

export function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

function createPreflightResponse(origin: string | null): Response {
  const headers = new Headers();
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers });
}
