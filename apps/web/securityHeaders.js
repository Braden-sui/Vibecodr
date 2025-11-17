const DEFAULTS = {
  runtimeCdnOrigin: "https://runtime.vibecodr.com",
  playerOrigin: "https://vibecodr.space",
  workerApiBase: "https://vibecodr-api.braden-yig.workers.dev",
  posthogHost: "https://us.i.posthog.com",
  posthogAssetOrigin: "https://us-assets.i.posthog.com",
  clerkScriptOrigin: "https://clerk.vibecodr.space",
  fontCdnOrigin: "https://r2cdn.perplexity.ai",
  cloudflareBeaconOrigin: "https://static.cloudflareinsights.com",
};

const CLERK_FRONTEND_HOSTS = [
  "https://clerk.accounts.dev",
  "https://*.clerk.com",
  "https://*.clerkstage.dev",
  "https://*.clerk.services",
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
  } catch {
    if (value.startsWith("//")) {
      try {
        return new URL(`https:${value}`).origin;
      } catch {
        return null;
      }
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

function resolvePosthogOrigin() {
  const raw = firstDefined([process.env.NEXT_PUBLIC_POSTHOG_HOST]);
  return normalizeOrigin(raw) || DEFAULTS.posthogHost;
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

function resolveFontOrigin() {
  const raw = firstDefined([
    process.env.NEXT_PUBLIC_FONT_CDN_ORIGIN,
    process.env.FONT_CDN_ORIGIN,
  ]);
  const origin = normalizeOrigin(raw);
  return origin || DEFAULTS.fontCdnOrigin;
}

function resolvePosthogAssetOrigin() {
  const raw = firstDefined([
    process.env.NEXT_PUBLIC_POSTHOG_ASSET_ORIGIN,
    process.env.POSTHOG_ASSET_ORIGIN,
  ]);
  return normalizeOrigin(raw) || DEFAULTS.posthogAssetOrigin;
}

function buildContentSecurityPolicy({ allowEmbedding = false } = {}) {
  const runtimeCdnSource = resolveRuntimeCdnSource();
  const playerOrigin = resolvePlayerOrigin();
  const workerApiOrigin = resolveWorkerApiOrigin();
  const posthogOrigin = resolvePosthogOrigin();
  const posthogAssetOrigin = resolvePosthogAssetOrigin();
  const clerkScriptOrigin = resolveClerkScriptOrigin();
  const fontOrigin = resolveFontOrigin();
  const cloudflareBeaconOrigin = DEFAULTS.cloudflareBeaconOrigin;

  const scriptSrc = uniqueSources([
    "'self'",
    runtimeCdnSource !== "'self'" ? runtimeCdnSource : null,
    clerkScriptOrigin,
    posthogAssetOrigin,
    cloudflareBeaconOrigin,
  ]);

  const connectSrc = uniqueSources([
    "'self'",
    workerApiOrigin,
    posthogOrigin,
    runtimeCdnSource !== "'self'" ? runtimeCdnSource : null,
    clerkScriptOrigin,
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

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `font-src ${fontSrc.join(" ")}`,
    `form-action 'self'`,
    `frame-src ${playerOrigin}`,
    `frame-ancestors ${allowEmbedding ? "*" : "'none'"}`,
    `img-src 'self' data: blob:`,
    `object-src 'none'`,
    `script-src ${scriptSrc.join(" ")} 'unsafe-inline'`,
    `worker-src ${workerSrc.join(" ")}`,
    `style-src 'self' 'unsafe-inline'`,
    `connect-src ${connectSrc.join(" ")}`,
    `upgrade-insecure-requests`,
  ];

  return directives.join("; ").replace(/\s{2,}/g, " ").trim();
}

function buildSecurityHeaders({ allowEmbedding = false } = {}) {
  const csp = buildContentSecurityPolicy({ allowEmbedding });
  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Embedder-Policy", value: allowEmbedding ? "credentialless" : "require-corp" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    {
      key: "Permissions-Policy",
      value:
        "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), microphone=(), midi=(), payment=(), usb=()",
    },
  ];

  return headers;
}

const BASE_HEADERS = buildSecurityHeaders({ allowEmbedding: false });
const EMBED_HEADERS = buildSecurityHeaders({ allowEmbedding: true });

function getSecurityHeaderSet({ allowEmbedding = false } = {}) {
  return allowEmbedding ? EMBED_HEADERS : BASE_HEADERS;
}

function applySecurityHeaders(response, { allowEmbedding = false } = {}) {
  const headerSet = getSecurityHeaderSet({ allowEmbedding });
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
