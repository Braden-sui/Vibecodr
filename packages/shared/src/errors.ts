// Shared error code definitions for Vibecodr
// Centralized so Workers, Next.js, and runtimes can agree on E-VIBECODR-#### semantics.

export type ErrorCategory =
  | "auth"
  | "moderation"
  | "api"
  | "import"
  | "capsule"
  | "manifest"
  | "runtime"
  | "og-image"
  | "proxy"
  | "internal";

export type ErrorSeverity = "info" | "warning" | "error";

export interface ErrorDefinition {
  code: string;
  category: ErrorCategory;
  httpStatus: number;
  severity: ErrorSeverity;
  userMessage: string;
  logMessage: string;
}

const definitions: Record<string, ErrorDefinition> = {
  // 0xxx: core platform and auth
  "E-VIBECODR-0001": {
    code: "E-VIBECODR-0001",
    category: "auth",
    httpStatus: 401,
    severity: "error",
    userMessage: "Authentication failed. Please sign in again.",
    logMessage: "Auth verification failed",
  },
  "E-VIBECODR-0002": {
    code: "E-VIBECODR-0002",
    category: "moderation",
    httpStatus: 403,
    severity: "error",
    userMessage: "You do not have permission to perform this action.",
    logMessage: "Moderation access denied",
  },
  "E-VIBECODR-0003": {
    code: "E-VIBECODR-0003",
    category: "auth",
    httpStatus: 500,
    severity: "error",
    userMessage: "Unable to attach session. Please refresh and try again.",
    logMessage: "Clerk token injection failed in edge proxy",
  },
  "E-VIBECODR-0004": {
    code: "E-VIBECODR-0004",
    category: "auth",
    httpStatus: 401,
    severity: "error",
    userMessage: "Authentication failed. Please sign in again.",
    logMessage: "Worker token is missing required claims",
  },
  "E-VIBECODR-0005": {
    code: "E-VIBECODR-0005",
    category: "auth",
    httpStatus: 401,
    severity: "error",
    userMessage: "Authentication failed. Please sign in again.",
    logMessage: "Worker token audience/azp mismatch",
  },
  "E-VIBECODR-0006": {
    code: "E-VIBECODR-0006",
    category: "auth",
    httpStatus: 401,
    severity: "error",
    userMessage: "Authentication failed. Please sign in again.",
    logMessage: "Worker token signature verification failed",
  },
  "E-VIBECODR-0007": {
    code: "E-VIBECODR-0007",
    category: "auth",
    httpStatus: 502,
    severity: "error",
    userMessage: "Authentication service is temporarily unavailable. Please retry.",
    logMessage: "Clerk JWKS download failed",
  },
  "E-VIBECODR-0008": {
    code: "E-VIBECODR-0008",
    category: "auth",
    httpStatus: 502,
    severity: "error",
    userMessage: "Authentication service is temporarily unavailable. Please retry.",
    logMessage: "Clerk JWKS response malformed",
  },

  // 01xx: social and moderation helpers
  "E-VIBECODR-0101": {
    code: "E-VIBECODR-0101",
    category: "api",
    httpStatus: 201,
    severity: "warning",
    userMessage: "Post created, but counters may be temporarily stale.",
    logMessage: "createPost counter update failed",
  },
  "E-VIBECODR-0102": {
    code: "E-VIBECODR-0102",
    category: "moderation",
    httpStatus: 503,
    severity: "error",
    userMessage: "Quarantine is temporarily unavailable. Please contact an administrator.",
    logMessage: "Moderation quarantine action failed while resolving report",
  },
  "E-VIBECODR-0103": {
    code: "E-VIBECODR-0103",
    category: "moderation",
    httpStatus: 503,
    severity: "error",
    userMessage: "Quarantine is temporarily unavailable. Please contact an administrator.",
    logMessage: "Direct post quarantine failed",
  },
  "E-VIBECODR-0104": {
    code: "E-VIBECODR-0104",
    category: "moderation",
    httpStatus: 503,
    severity: "error",
    userMessage: "Quarantine is temporarily unavailable. Please contact an administrator.",
    logMessage: "Direct comment quarantine failed",
  },
  "E-VIBECODR-0105": {
    code: "E-VIBECODR-0105",
    category: "moderation",
    httpStatus: 503,
    severity: "error",
    userMessage: "Quarantine is temporarily unavailable. Please contact an administrator.",
    logMessage: "Direct post unquarantine failed",
  },
  "E-VIBECODR-0106": {
    code: "E-VIBECODR-0106",
    category: "moderation",
    httpStatus: 503,
    severity: "error",
    userMessage: "Quarantine is temporarily unavailable. Please contact an administrator.",
    logMessage: "Direct comment unquarantine failed",
  },
  "E-VIBECODR-0108": {
    code: "E-VIBECODR-0108",
    category: "api",
    httpStatus: 202,
    severity: "warning",
    userMessage: "We saved your action, but profile counts may be temporarily stale.",
    logMessage: "User counters update failed",
  },
  "E-VIBECODR-0109": {
    code: "E-VIBECODR-0109",
    category: "api",
    httpStatus: 202,
    severity: "warning",
    userMessage: "We saved your action, but post stats may be temporarily stale.",
    logMessage: "Post stats update failed",
  },
  "E-VIBECODR-0110": {
    code: "E-VIBECODR-0110",
    category: "capsule",
    httpStatus: 202,
    severity: "warning",
    userMessage: "Remix counts may be temporarily delayed.",
    logMessage: "Remix counter update failed during publish",
  },
  "E-VIBECODR-0111": {
    code: "E-VIBECODR-0111",
    category: "capsule",
    httpStatus: 202,
    severity: "warning",
    userMessage: "We published your remix, but linking to the parent may be delayed.",
    logMessage: "Remix relationship insert failed during publish",
  },

  // 02xx: capsule manifest parsing and validation in feed/player paths
  "E-VIBECODR-0201": {
    code: "E-VIBECODR-0201",
    category: "manifest",
    httpStatus: 500,
    severity: "error",
    userMessage: "This capsule is currently unavailable.",
    logMessage: "Capsule manifest JSON parse failed",
  },
  "E-VIBECODR-0202": {
    code: "E-VIBECODR-0202",
    category: "manifest",
    httpStatus: 500,
    severity: "error",
    userMessage: "This capsule is currently unavailable.",
    logMessage: "Capsule manifest validation failed",
  },
  "E-VIBECODR-0203": {
    code: "E-VIBECODR-0203",
    category: "manifest",
    httpStatus: 500,
    severity: "error",
    userMessage: "This capsule is currently unavailable.",
    logMessage: "Required capsule manifest missing for source view",
  },

  // 06xx: capsule access control
  "E-VIBECODR-0601": {
    code: "E-VIBECODR-0601",
    category: "capsule",
    httpStatus: 404,
    severity: "error",
    userMessage: "This capsule is not available.",
    logMessage: "Capsule access blocked by policy or visibility",
  },

  // 11xx: compile/manifest/runtime setup
  "E-VIBECODR-1100": {
    code: "E-VIBECODR-1100",
    category: "manifest",
    httpStatus: 400,
    severity: "error",
    userMessage: "The capsule manifest is invalid.",
    logMessage: "Manifest schema validation failed",
  },
  "E-VIBECODR-1101": {
    code: "E-VIBECODR-1101",
    category: "og-image",
    httpStatus: 502,
    severity: "warning",
    userMessage: "Post preview is temporarily unavailable.",
    logMessage: "OG image fetch for post failed",
  },
  "E-VIBECODR-1103": {
    code: "E-VIBECODR-1103",
    category: "manifest",
    httpStatus: 400,
    severity: "error",
    userMessage: "This capsule uses an unsupported import.",
    logMessage: "Manifest import allowlist violation",
  },
  "E-VIBECODR-1104": {
    code: "E-VIBECODR-1104",
    category: "runtime",
    httpStatus: 202,
    severity: "warning",
    userMessage: "Compile telemetry for this capsule may be temporarily degraded.",
    logMessage: "ArtifactCompiler state write failed while recording last compile request",
  },
  "E-VIBECODR-1105": {
    code: "E-VIBECODR-1105",
    category: "runtime",
    httpStatus: 202,
    severity: "warning",
    userMessage: "Compile telemetry for this capsule may be temporarily degraded.",
    logMessage: "ArtifactCompiler analytics datapoint write failed",
  },
  "E-VIBECODR-1114": {
    code: "E-VIBECODR-1114",
    category: "runtime",
    httpStatus: 202,
    severity: "warning",
    userMessage: "Bundle warning telemetry is temporarily degraded.",
    logMessage: "Artifact bundle warning telemetry write failed",
  },
  "E-VIBECODR-1110": {
    code: "E-VIBECODR-1110",
    category: "manifest",
    httpStatus: 400,
    severity: "error",
    userMessage: "This capsule exceeds the allowed bundle size for the current plan.",
    logMessage: "Manifest bundle size exceeds allowed maximum",
  },

  // 12xx: runtime manifest retrieval
  "E-VIBECODR-1201": {
    code: "E-VIBECODR-1201",
    category: "runtime",
    httpStatus: 500,
    severity: "error",
    userMessage: "Failed to load the runtime manifest for this artifact.",
    logMessage: "Runtime manifest JSON parse failed",
  },
  "E-VIBECODR-1202": {
    code: "E-VIBECODR-1202",
    category: "runtime",
    httpStatus: 500,
    severity: "error",
    userMessage: "Failed to load the runtime manifest for this artifact.",
    logMessage: "getArtifactManifest handler failed",
  },
  "E-VIBECODR-1203": {
    code: "E-VIBECODR-1203",
    category: "runtime",
    httpStatus: 500,
    severity: "warning",
    userMessage: "Runtime manifest cache is unavailable; retrying with a fallback.",
    logMessage: "Runtime manifest KV read failed",
  },

  // 21xx: runtime execution
  "E-VIBECODR-2101": {
    code: "E-VIBECODR-2101",
    category: "runtime",
    httpStatus: 500,
    severity: "error",
    userMessage: "The capsule crashed while running.",
    logMessage: "Artifact runtime crashed inside sandbox",
  },
  "E-VIBECODR-2102": {
    code: "E-VIBECODR-2102",
    category: "runtime",
    httpStatus: 500,
    severity: "error",
    userMessage: "The capsule failed while processing a runtime bridge message.",
    logMessage: "Runtime bridge handler threw while processing postMessage payload",
  },
  "E-VIBECODR-2120": {
    code: "E-VIBECODR-2120",
    category: "runtime",
    httpStatus: 403,
    severity: "error",
    userMessage: "Browser storage APIs are disabled inside this capsule.",
    logMessage: "Runtime guard blocked local/session storage access",
  },
  "E-VIBECODR-2121": {
    code: "E-VIBECODR-2121",
    category: "runtime",
    httpStatus: 403,
    severity: "error",
    userMessage: "Cookie access is disabled inside this capsule.",
    logMessage: "Runtime guard blocked document.cookie access",
  },
  "E-VIBECODR-2122": {
    code: "E-VIBECODR-2122",
    category: "runtime",
    httpStatus: 403,
    severity: "error",
    userMessage: "Navigation APIs are disabled inside this capsule.",
    logMessage: "Runtime guard blocked window.open/navigation attempt",
  },
  "E-VIBECODR-2130": {
    code: "E-VIBECODR-2130",
    category: "runtime",
    httpStatus: 500,
    severity: "error",
    userMessage: "Runtime analytics collection is temporarily unavailable. Please retry.",
    logMessage: "Runtime analytics write failed",
  },
  "E-VIBECODR-2131": {
    code: "E-VIBECODR-2131",
    category: "runtime",
    httpStatus: 500,
    severity: "error",
    userMessage: "Unable to load runtime analytics data right now.",
    logMessage: "Runtime analytics summary fetch failed",
  },
  "E-VIBECODR-2136": {
    code: "E-VIBECODR-2136",
    category: "runtime",
    httpStatus: 202,
    severity: "warning",
    userMessage: "Run log telemetry is temporarily unavailable; some logs may be missing.",
    logMessage: "Runtime appendRunLogs analytics write failed",
  },
};

export type ErrorCode = keyof typeof definitions;

export const ERROR_AUTH_VERIFICATION_FAILED: ErrorCode = "E-VIBECODR-0001";
export const ERROR_AUTH_CLAIMS_INVALID: ErrorCode = "E-VIBECODR-0004";
export const ERROR_AUTH_AUDIENCE_MISMATCH: ErrorCode = "E-VIBECODR-0005";
export const ERROR_AUTH_SIGNATURE_INVALID: ErrorCode = "E-VIBECODR-0006";
export const ERROR_AUTH_JWKS_FETCH_FAILED: ErrorCode = "E-VIBECODR-0007";
export const ERROR_AUTH_JWKS_PARSE_FAILED: ErrorCode = "E-VIBECODR-0008";
export const ERROR_CAPSULE_ACCESS_BLOCKED: ErrorCode = "E-VIBECODR-0601";
export const ERROR_MANIFEST_INVALID: ErrorCode = "E-VIBECODR-1100";
export const ERROR_MANIFEST_TOO_LARGE: ErrorCode = "E-VIBECODR-1110";
export const ERROR_ARTIFACT_COMPILER_STATE_WRITE_FAILED: ErrorCode = "E-VIBECODR-1104";
export const ERROR_ARTIFACT_COMPILER_ANALYTICS_FAILED: ErrorCode = "E-VIBECODR-1105";
export const ERROR_BUNDLE_WARNING_TELEMETRY_FAILED: ErrorCode = "E-VIBECODR-1114";
export const ERROR_RUNTIME_MANIFEST_PARSE_FAILED: ErrorCode = "E-VIBECODR-1201";
export const ERROR_RUNTIME_MANIFEST_LOAD_FAILED: ErrorCode = "E-VIBECODR-1202";
export const ERROR_RUNTIME_MANIFEST_KV_UNAVAILABLE: ErrorCode = "E-VIBECODR-1203";
export const ERROR_RUNTIME_BRIDGE_HANDLER_FAILED: ErrorCode = "E-VIBECODR-2102";
export const ERROR_RUNTIME_STORAGE_BLOCKED: ErrorCode = "E-VIBECODR-2120";
export const ERROR_RUNTIME_COOKIE_BLOCKED: ErrorCode = "E-VIBECODR-2121";
export const ERROR_RUNTIME_NAVIGATION_BLOCKED: ErrorCode = "E-VIBECODR-2122";
export const ERROR_RUNTIME_ANALYTICS_FAILED: ErrorCode = "E-VIBECODR-2130";
export const ERROR_RUNTIME_ANALYTICS_SUMMARY_FAILED: ErrorCode = "E-VIBECODR-2131";

export function getErrorDefinition(code: string): ErrorDefinition | undefined {
  return definitions[code];
}

export function isKnownErrorCode(code: string | undefined | null): code is ErrorCode {
  return !!code && code in definitions;
}
