const DEFAULTS = {
  runtimeCdnOrigin: "https://runtime.vibecodr.com",
  playerOrigin: "https://vibecodr.space",
  workerApiBase: "https://vibecodr-api.braden-yig.workers.dev",
  clerkScriptOrigin: "https://clerk.vibecodr.space",
  clerkAccountsOrigin: "https://accounts.vibecodr.space",
  fontCdnOrigin: "https://r2cdn.perplexity.ai",
  cloudflareBeaconOrigin: "https://static.cloudflareinsights.com",
};

const CLERK_FRONTEND_HOSTS = [
  "https://clerk.accounts.dev",
  "https://*.clerk.com",
  "https://*.clerkstage.dev",
  "https://*.clerk.services",
];

const CLERK_IMAGE_DEFAULT_ORIGINS = [
  "https://img.clerk.com",
  "https://images.clerk.dev",
];

const EMBED_PATH_PREFIX = "/e";

function firstDefined(candidates) {
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function normalizeOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch (error) {
    if (value.startsWith("//")) {
      try {
        return new URL(`https:${value}`).origin;
      } catch (nestedError) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("E-VIBECODR-0514 security header origin parse failed", {
            value,
            error: nestedError instanceof Error ? nestedError.message : String(nestedError),
          });
        }
        return null;
      }
    }
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error("E-VIBECODR-0514 security header origin parse failed", {
        value,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

function resolveRuntimeCdnSource() {
  const raw = firstDefined([
    process.env.NEXT_PUBLIC_RUNTIME_CDN_ORIGIN,
    process.env.RUNTIME_CDN_ORIGIN,
  ]);

  if (!raw) {
    return DEFAULTS.runtimeCdnOrigin;
  }

  if (raw === "self" || raw === "'self'") {
    return "'self'";
  }

  if (raw.startsWith("/")) {
    return "'self'";
  }

  return normalizeOrigin(raw) || DEFAULTS.runtimeCdnOrigin;
}

function resolvePlayerOrigin() {
  const raw = firstDefined([
    process.env.NEXT_PUBLIC_PLAYER_ORIGIN,
    process.env.NEXT_PUBLIC_BASE_URL,
  ]);

  return normalizeOrigin(raw) || DEFAULTS.playerOrigin;
}

function resolveWorkerApiOrigin() {
  const raw = firstDefined([
    process.env.WORKER_API_BASE,
    process.env.NEXT_PUBLIC_API_BASE,
    process.env.NEXT_PUBLIC_API_URL,
  ]);

  return normalizeOrigin(raw) || DEFAULTS.workerApiBase;
}

function uniqueSources(values) {
  return Array.from(
    new Set(values.filter((value) => typeof value === "string" && value.length > 0))
  );
}

function resolveClerkScriptOrigin() {
  const raw = firstDefined([
    process.env.NEXT_PUBLIC_CLERK_JS_SCRIPT_URL,
    process.env.CLERK_JS_SCRIPT_URL,
  ]);
  const origin = normalizeOrigin(raw);
  return origin || DEFAULTS.clerkScriptOrigin;
}

function resolveClerkAccountsOrigin() {
  const raw = firstDefined([
    process.env.NEXT_PUBLIC_CLERK_ACCOUNTS_ORIGIN,
    process.env.CLERK_ACCOUNTS_ORIGIN,
  ]);
  const origin = normalizeOrigin(raw);
  return origin || DEFAULTS.clerkAccountsOrigin;
}

function resolveFontOrigin() {
  const raw = firstDefined([
    process.env.NEXT_PUBLIC_FONT_CDN_ORIGIN,
    process.env.FONT_CDN_ORIGIN,
  ]);
  const origin = normalizeOrigin(raw);
  return origin || DEFAULTS.fontCdnOrigin;
}

function resolveClerkImageOrigins() {
  const raw = firstDefined([
    process.env.NEXT_PUBLIC_CLERK_IMAGE_ORIGINS,
    process.env.CLERK_IMAGE_ORIGINS,
  ]);

  if (!raw) {
    return [...CLERK_IMAGE_DEFAULT_ORIGINS];
  }

  const origins = raw
    .split(",")
    .map((value) => normalizeOrigin(value))
    .filter((value) => typeof value === "string");

  return origins.length > 0 ? uniqueSources(origins) : [...CLERK_IMAGE_DEFAULT_ORIGINS];
}

function normalizeSourceList(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? v.trim() : "")).filter((v) => v.length > 0);
  }

  return [];
}

function buildContentSecurityPolicy({
  allowEmbedding = false,
  frameAncestors,
  scriptNonce,
  styleNonce,
} = {}) {
  const runtimeCdnSource = resolveRuntimeCdnSource();
  const playerOrigin = resolvePlayerOrigin();
  const workerApiOrigin = resolveWorkerApiOrigin();
  const clerkScriptOrigin = resolveClerkScriptOrigin();
  const clerkAccountsOrigin = resolveClerkAccountsOrigin();
  const fontOrigin = resolveFontOrigin();
  const cloudflareBeaconOrigin = DEFAULTS.cloudflareBeaconOrigin;
  const clerkImageOrigins = resolveClerkImageOrigins();
  const scriptNonceSource = scriptNonce ? `'nonce-${scriptNonce}'` : null;
  const styleNonceSource = styleNonce ? `'nonce-${styleNonce}'` : null;

  const scriptSrc = uniqueSources([
    "'self'",
    runtimeCdnSource !== "'self'" ? runtimeCdnSource : null,
    clerkScriptOrigin,
    cloudflareBeaconOrigin,
    scriptNonceSource,
  ]);

  const connectSrc = uniqueSources([
    "'self'",
    workerApiOrigin,
    runtimeCdnSource !== "'self'" ? runtimeCdnSource : null,
    clerkScriptOrigin,
    clerkAccountsOrigin,
    ...CLERK_FRONTEND_HOSTS,
  ]);

  const fontSrc = uniqueSources([
    "'self'",
    "data:",
    fontOrigin,
  ]);

  const workerSrc = uniqueSources([
    "'self'",
    "blob:",
  ]);

  const imgSrc = uniqueSources([
    "'self'",
    "data:",
    "blob:",
    ...clerkImageOrigins,
  ]);

  const styleSrc = uniqueSources([
    "'self'",
    styleNonceSource,
  ]);

  const frameAncestorsSources = normalizeSourceList(frameAncestors);
  const resolvedFrameAncestors =
    frameAncestorsSources.length > 0 ? frameAncestorsSources.join(" ") : allowEmbedding ? "*" : "'none'";

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `font-src ${fontSrc.join(" ")}`,
    `form-action 'self'`,
    `frame-src ${playerOrigin}`,
    `frame-ancestors ${resolvedFrameAncestors}`,
    `img-src ${imgSrc.join(" ")}`,
    `object-src 'none'`,
    `script-src ${scriptSrc.join(" ")}`,
    `worker-src ${workerSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    `upgrade-insecure-requests`,
  ];

  return directives.join("; ").replace(/\s{2,}/g, " ").trim();
}

function buildSecurityHeaders({
  allowEmbedding = false,
  frameAncestors,
  crossOriginEmbedderPolicy,
  scriptNonce,
  styleNonce,
} = {}) {
  const csp = buildContentSecurityPolicy({ allowEmbedding, frameAncestors, scriptNonce, styleNonce });
  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];

  const coep =
    crossOriginEmbedderPolicy === null
      ? null
      : typeof crossOriginEmbedderPolicy === "string"
        ? crossOriginEmbedderPolicy
        : allowEmbedding
          ? "credentialless"
          : "require-corp";

  if (coep) {
    headers.push({ key: "Cross-Origin-Embedder-Policy", value: coep });
  }

  headers.push(
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" }
  );

  return headers;
}

const BASE_HEADERS = buildSecurityHeaders({ allowEmbedding: false });
const EMBED_HEADERS = buildSecurityHeaders({ allowEmbedding: true });

function getSecurityHeaderSet(options = {}) {
  const {
    allowEmbedding = false,
    frameAncestors,
    crossOriginEmbedderPolicy,
    scriptNonce,
    styleNonce,
  } = options;

  if (scriptNonce || styleNonce || frameAncestors !== undefined || crossOriginEmbedderPolicy !== undefined) {
    return buildSecurityHeaders({ allowEmbedding, frameAncestors, crossOriginEmbedderPolicy, scriptNonce, styleNonce });
  }

  return allowEmbedding ? EMBED_HEADERS : BASE_HEADERS;
}

function applySecurityHeaders(response, options = {}) {
  const headerSet = getSecurityHeaderSet(options);
  for (const header of headerSet) {
    response.headers.set(header.key, header.value);
  }
  return response;
}

const exported = {
  EMBED_PATH_PREFIX,
  buildSecurityHeaders,
  getSecurityHeaderSet,
  applySecurityHeaders,
};

module.exports = exported;
module.exports.default = exported;
