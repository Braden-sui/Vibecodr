import type { Env, Handler } from "./index";
import {
  ERROR_AUTH_AUDIENCE_MISMATCH,
  ERROR_AUTH_CLAIMS_INVALID,
  ERROR_AUTH_JWKS_FETCH_FAILED,
  ERROR_AUTH_JWKS_PARSE_FAILED,
  ERROR_AUTH_SIGNATURE_INVALID,
  ERROR_AUTH_VERIFICATION_FAILED,
  getErrorDefinition,
  type ErrorCode,
} from "@vibecodr/shared";

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  claims: ClerkJwtPayload;
}

export function requireAdmin(
  handler: (
    req: Request,
    env: Env,
    ctx: ExecutionContext,
    params: Record<string, string>,
    user: AuthenticatedUser
  ) => Promise<Response>
) {
  return requireAuth(async (req, env, ctx, params, user) => {
    if (!isAdmin(user)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handler(req, env, ctx, params, user);
  });
}

export function isModeratorOrAdmin(user: AuthenticatedUser | { claims: ClerkJwtPayload }): boolean {
  const claims = user.claims as any;
  const publicMetadata = (claims.public_metadata || claims.publicMetadata || {}) as any;

  const role = (claims.role as string | undefined) ?? (publicMetadata.role as string | undefined);
  const isModeratorFlag =
    (claims.isModerator as boolean | undefined) ?? (publicMetadata.isModerator as boolean | undefined);

  if (role === "admin" || role === "moderator") {
    return true;
  }

  return isModeratorFlag === true;
}

export function isAdmin(user: AuthenticatedUser | { claims: ClerkJwtPayload }): boolean {
  const claims = user.claims as any;
  const publicMetadata = (claims.public_metadata || claims.publicMetadata || {}) as any;
  const role = (claims.role as string | undefined) ?? (publicMetadata.role as string | undefined);
  return role === "admin";
}

type JwtHeader = {
  alg: string;
  kid?: string;
  typ?: string;
};

type ClerkJwtPayload = {
  iss: string;
  sub: string;
  sid?: string;
  aud?: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  azp?: string;
  [key: string]: unknown;
};

class WorkerAuthError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "WorkerAuthError";
  }
}

type JwksCacheEntry = {
  keys: Map<string, CryptoKey>;
  expiresAt: number;
};

type ClerkJwk = JsonWebKey & { kid?: string };

const jwksCache = new Map<string, JwksCacheEntry>();
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const DEFAULT_JWKS_CACHE_TTL_MS = 15 * 60 * 1000;
const JWKS_CACHE_MIN_TTL_MS = 30 * 1000;
const JWKS_CACHE_MAX_TTL_MS = 60 * 60 * 1000;
const MAX_CLOCK_SKEW = 60; // seconds

function toWorkerAuthError(error: unknown): WorkerAuthError {
  if (error instanceof WorkerAuthError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new WorkerAuthError(ERROR_AUTH_VERIFICATION_FAILED, message);
}

function logAuthFailure(error: WorkerAuthError) {
  const definition = getErrorDefinition(error.code);
  const prefix = definition ? `${error.code} ${definition.logMessage}` : `${error.code} Auth verification failed`;

  console.error(prefix, {
    errorCode: error.code,
    message: error.message,
    stack: error.stack,
  });
}

export async function verifyAuth(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return null;
  }

  try {
    const { payload } = await verifyClerkJwt(token, env);

    const userId = (payload.sub || (payload as any).userId) as string | undefined;
    if (!userId) {
      throw new Error("Missing Clerk user id");
    }

    const sessionId = (payload.sid || (payload as any).session_id || "") as string;

    return {
      userId,
      sessionId,
      claims: payload,
    };
  } catch (error) {
    logAuthFailure(toWorkerAuthError(error));
    return null;
  }
}

export function requireAuth(
  handler: (
    req: Request,
    env: Env,
    ctx: ExecutionContext,
    params: Record<string, string>,
    user: AuthenticatedUser
  ) => Promise<Response>
) {
  return async (
    req: Request,
    env: Env,
    ctx: ExecutionContext,
    params: Record<string, string>
  ): Promise<Response> => {
    const user = await verifyAuth(req, env);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handler(req, env, ctx, params, user);
  };
}

export type RequireUserHandler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  userId: string
) => Promise<Response>;

export function requireUser(handler: RequireUserHandler): Handler {
  return requireAuth((req, env, ctx, params, user) => handler(req, env, ctx, params, user.userId));
}

async function verifyClerkJwt(token: string, env: Env): Promise<{ header: JwtHeader; payload: ClerkJwtPayload }> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new WorkerAuthError(ERROR_AUTH_CLAIMS_INVALID, "Invalid JWT format");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJwtSection<JwtHeader>(encodedHeader);
  const payload = parseJwtSection<ClerkJwtPayload>(encodedPayload);

  if (header.alg !== "RS256") {
    throw new WorkerAuthError(ERROR_AUTH_CLAIMS_INVALID, `Unsupported jwt alg ${header.alg}`);
  }
  if (!header.kid) {
    throw new WorkerAuthError(ERROR_AUTH_CLAIMS_INVALID, "Missing jwt kid");
  }
  if (!payload.sub) {
    throw new WorkerAuthError(ERROR_AUTH_CLAIMS_INVALID, "Missing jwt sub");
  }

  const issuer = normalizeIssuer(env.CLERK_JWT_ISSUER);
  const tokenIssuer = normalizeIssuer(payload.iss);
  if (!issuer) {
    throw new WorkerAuthError(ERROR_AUTH_CLAIMS_INVALID, "Clerk issuer not configured");
  }
  if (!tokenIssuer || tokenIssuer !== issuer) {
    throw new WorkerAuthError(ERROR_AUTH_CLAIMS_INVALID, "Issuer mismatch");
  }

  enforceTimestamps(payload);
  const allowedAudiences = parseConfiguredAudiences(env.CLERK_JWT_AUDIENCE);
  enforceAudienceClaims(payload, allowedAudiences);

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signatureBytes = base64UrlDecode(encodedSignature);
  const data = textEncoder.encode(signingInput);
  const key = await getSigningKey(issuer, header.kid);
  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    signatureBytes as unknown as BufferSource,
    data as unknown as BufferSource
  );

  if (!valid) {
    throw new WorkerAuthError(ERROR_AUTH_SIGNATURE_INVALID, "Invalid jwt signature");
  }

  return { header, payload: { ...payload, iss: issuer } };
}

function parseJwtSection<T>(segment: string): T {
  try {
    const json = textDecoder.decode(base64UrlDecode(segment));
    return JSON.parse(json) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    throw new WorkerAuthError(ERROR_AUTH_CLAIMS_INVALID, `Invalid JWT section: ${reason}`);
  }
}

function base64UrlDecode(segment: string): Uint8Array {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4 || 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function normalizeIssuer(issuer?: string): string | undefined {
  if (!issuer) return undefined;
  return issuer.replace(/\/+$/, "");
}

function enforceTimestamps(payload: ClerkJwtPayload) {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && now - payload.exp > MAX_CLOCK_SKEW) {
    throw new WorkerAuthError(ERROR_AUTH_CLAIMS_INVALID, "JWT has expired");
  }
  if (typeof payload.nbf === "number" && payload.nbf - now > MAX_CLOCK_SKEW) {
    throw new WorkerAuthError(ERROR_AUTH_CLAIMS_INVALID, "JWT not yet valid");
  }
}

function parseConfiguredAudiences(audienceEnv?: string): string[] {
  if (!audienceEnv) {
    return [];
  }

  const normalized = audienceEnv.trim();
  if (!normalized) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      return parsed.map((value) => String(value).trim()).filter(Boolean);
    }
    if (typeof parsed === "string" && parsed.trim()) {
      return [parsed.trim()];
    }
  } catch (error) {
    console.error("E-VIBECODR-0009 auth audience env JSON parse failed", {
      audienceEnv,
      error: error instanceof Error ? error.message : String(error),
    });
    // fall through to comma-delimited parsing
  }

  if (normalized === "[]") {
    return [];
  }

  return normalized
    .split(",")
    .map((aud) => aud.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function enforceAudienceClaims(payload: ClerkJwtPayload, allowedAudiences: string[]) {
  if (!allowedAudiences.length) {
    return;
  }

  const tokenAud = (Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [])
    .map((aud) => (typeof aud === "string" ? aud.trim() : String(aud)))
    .filter(Boolean);
  const matchesAudience = tokenAud.some((aud) => allowedAudiences.includes(aud));
  if (!matchesAudience) {
    throw new WorkerAuthError(ERROR_AUTH_AUDIENCE_MISMATCH, "Audience mismatch");
  }

  const authorizedParty = typeof payload.azp === "string" ? payload.azp.trim() : undefined;
  if (authorizedParty) {
    if (!allowedAudiences.includes(authorizedParty)) {
      throw new WorkerAuthError(ERROR_AUTH_AUDIENCE_MISMATCH, "Authorized party mismatch");
    }
    return;
  }

  if (tokenAud.length > 1) {
    throw new WorkerAuthError(ERROR_AUTH_AUDIENCE_MISMATCH, "Authorized party mismatch");
  }
}

async function getSigningKey(issuer: string, kid: string): Promise<CryptoKey> {
  const now = Date.now();
  let cache = jwksCache.get(issuer);
  if (!cache || cache.expiresAt <= now) {
    cache = await refreshJwks(issuer);
  }

  let key = cache.keys.get(kid);
  if (!key) {
    cache = await refreshJwks(issuer);
    key = cache.keys.get(kid);
  }

  if (!key) {
    throw new WorkerAuthError(ERROR_AUTH_CLAIMS_INVALID, `Unable to resolve signing key for kid ${kid}`);
  }

  return key;
}

async function refreshJwks(issuer: string): Promise<JwksCacheEntry> {
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  let res: Response;
  try {
    res = await fetch(jwksUrl, {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    throw new WorkerAuthError(ERROR_AUTH_JWKS_FETCH_FAILED, `Failed to download Clerk JWKS: ${reason}`);
  }

  if (!res.ok) {
    throw new WorkerAuthError(ERROR_AUTH_JWKS_FETCH_FAILED, `Failed to download Clerk JWKS (${res.status})`);
  }

  let body: { keys?: ClerkJwk[] };
  try {
    body = (await res.json()) as { keys?: ClerkJwk[] };
  } catch {
    throw new WorkerAuthError(ERROR_AUTH_JWKS_PARSE_FAILED, "Malformed Clerk JWKS response");
  }
  if (!Array.isArray(body.keys)) {
    throw new WorkerAuthError(ERROR_AUTH_JWKS_PARSE_FAILED, "Malformed Clerk JWKS response");
  }

  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys) {
    if (!jwk.kid || jwk.kty !== "RSA") {
      continue;
    }
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "jwk",
        { ...jwk, ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
      keys.set(jwk.kid, cryptoKey);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      throw new WorkerAuthError(ERROR_AUTH_JWKS_PARSE_FAILED, `Failed to import Clerk JWKS key: ${reason}`);
    }
  }

  if (!keys.size) {
    throw new WorkerAuthError(ERROR_AUTH_JWKS_PARSE_FAILED, "No usable Clerk signing keys returned");
  }

  const entry: JwksCacheEntry = {
    keys,
    expiresAt: determineJwksExpiry(res),
  };
  jwksCache.set(issuer, entry);
  return entry;
}

function determineJwksExpiry(res: Response): number {
  const now = Date.now();
  const cacheControl = res.headers.get("cache-control");
  if (cacheControl) {
    const match = cacheControl.match(/max-age=(\d+)/i);
    if (match) {
      const seconds = parseInt(match[1], 10);
      if (!Number.isNaN(seconds) && seconds > 0) {
        return now + clamp(seconds * 1000, JWKS_CACHE_MIN_TTL_MS, JWKS_CACHE_MAX_TTL_MS);
      }
    }
  }

  const expiresHeader = res.headers.get("expires");
  if (expiresHeader) {
    const expiresAt = Date.parse(expiresHeader);
    if (!Number.isNaN(expiresAt) && expiresAt > now) {
      return now + clamp(expiresAt - now, JWKS_CACHE_MIN_TTL_MS, JWKS_CACHE_MAX_TTL_MS);
    }
  }

  return now + DEFAULT_JWKS_CACHE_TTL_MS;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// WHY: Test suites rely on deterministic JWKS caching behavior.
export function __resetAuthStateForTests() {
  jwksCache.clear();
}
