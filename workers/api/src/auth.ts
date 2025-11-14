import type { Env, Handler } from "./index";

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

type JwksCacheEntry = {
  keys: Map<string, CryptoKey>;
  expiresAt: number;
};

type ClerkJwk = JsonWebKey & { kid?: string };

const jwksCache = new Map<string, JwksCacheEntry>();
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const JWKS_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CLOCK_SKEW = 60; // seconds

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
    console.error("E-VIBECODR-0001 auth verification failed", {
      message: error instanceof Error ? error.message : String(error),
    });
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
    throw new Error("Invalid JWT format");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJwtSection<JwtHeader>(encodedHeader);
  const payload = parseJwtSection<ClerkJwtPayload>(encodedPayload);

  if (header.alg !== "RS256") {
    throw new Error(`Unsupported jwt alg ${header.alg}`);
  }
  if (!header.kid) {
    throw new Error("Missing jwt kid");
  }
  if (!payload.sub) {
    throw new Error("Missing jwt sub");
  }

  const issuer = normalizeIssuer(env.CLERK_JWT_ISSUER);
  const tokenIssuer = normalizeIssuer(payload.iss);
  if (!issuer || !tokenIssuer) {
    throw new Error("Clerk issuer not configured");
  }
  if (tokenIssuer !== issuer) {
    throw new Error("Issuer mismatch");
  }

  enforceTimestamps(payload);
  enforceAudience(payload, env.CLERK_JWT_AUDIENCE);

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
    throw new Error("Invalid jwt signature");
  }

  return { header, payload: { ...payload, iss: issuer } };
}

function parseJwtSection<T>(segment: string): T {
  const json = textDecoder.decode(base64UrlDecode(segment));
  return JSON.parse(json) as T;
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
    throw new Error("JWT has expired");
  }
  if (typeof payload.nbf === "number" && payload.nbf - now > MAX_CLOCK_SKEW) {
    throw new Error("JWT not yet valid");
  }
}

function enforceAudience(payload: ClerkJwtPayload, audienceEnv?: string) {
  if (!audienceEnv) {
    return;
  }

  const normalized = audienceEnv.trim();
  if (!normalized || normalized === "[]") {
    return;
  }

  const allowedAudiences = normalized
    .split(",")
    .map((aud) => aud.trim())
    .filter(Boolean);
  if (!allowedAudiences.length) {
    return;
  }
  const tokenAud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  const matches = tokenAud.some((aud) => allowedAudiences.includes(aud));
  if (!matches) {
    throw new Error("Audience mismatch");
  }
}

async function getSigningKey(issuer: string, kid: string): Promise<CryptoKey> {
  const now = Date.now();
  let cache = jwksCache.get(issuer);
  if (!cache || cache.expiresAt < now) {
    cache = await refreshJwks(issuer);
  }

  let key = cache.keys.get(kid);
  if (!key) {
    cache = await refreshJwks(issuer);
    key = cache.keys.get(kid);
  }

  if (!key) {
    throw new Error(`Unable to resolve signing key for kid ${kid}`);
  }

  return key;
}

async function refreshJwks(issuer: string): Promise<JwksCacheEntry> {
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  const res = await fetch(jwksUrl, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to download Clerk JWKS (${res.status})`);
  }

  const body = (await res.json()) as { keys?: ClerkJwk[] };
  if (!Array.isArray(body.keys)) {
    throw new Error("Malformed Clerk JWKS response");
  }

  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys) {
    if (!jwk.kid || jwk.kty !== "RSA") {
      continue;
    }
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    keys.set(jwk.kid, cryptoKey);
  }

  const entry: JwksCacheEntry = {
    keys,
    expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
  };
  jwksCache.set(issuer, entry);
  return entry;
}
