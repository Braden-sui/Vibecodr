// User-friendly error messages for runtime failures
// WHY: Map known error codes to actionable messages shown in the Player UI

type RuntimeErrorInfo = {
  title: string;
  message: string;
  suggestion?: string;
};

const RUNTIME_ERROR_MAP: Record<string, RuntimeErrorInfo> = {
  // Artifact not found / wrong status
  "E-VIBECODR-0601": {
    title: "Vibe Not Available",
    message: "This vibe isn't available right now.",
    suggestion: "It may have been deleted or is under review.",
  },
  // Rate limit exceeded
  "E-VIBECODR-0312": {
    title: "Rate Limit",
    message: "You've hit the rate limit for loading vibes.",
    suggestion: "Please wait a moment and try again.",
  },
  // Run quota exceeded
  "E-VIBECODR-0605": {
    title: "Run Limit Reached",
    message: "You've hit your run limit on the free plan.",
    suggestion: "Upgrade to run more vibes.",
  },
  // Runtime manifest failures
  "E-VIBECODR-2109": {
    title: "Failed to Load",
    message: "We couldn't load the runtime manifest for this vibe.",
    suggestion: "Try refreshing the page.",
  },
  "E-VIBECODR-2110": {
    title: "Missing Assets",
    message: "Some runtime assets are missing for this vibe.",
    suggestion: "This may be a temporary issue. Try again later.",
  },
  // HTML bundle failures
  "E-VIBECODR-2111": {
    title: "Bundle Load Failed",
    message: "We couldn't load the HTML bundle for this vibe.",
    suggestion: "Check your network connection or try again.",
  },
  "E-VIBECODR-2112": {
    title: "Runtime Error",
    message: "The HTML runtime is not available.",
    suggestion: "This may be a bug in Vibecodr. Please report it.",
  },
  // Unsupported runtime type
  "E-VIBECODR-2107": {
    title: "Unsupported Format",
    message: "This vibe uses an unsupported runtime type.",
    suggestion: "The vibe may have been created with an older version.",
  },
  // Runtime loader failed
  "E-VIBECODR-2108": {
    title: "Loader Error",
    message: "The runtime loader failed to initialize.",
    suggestion: "Try refreshing the page or clearing your cache.",
  },
  // Runtime crashed
  "E-VIBECODR-2101": {
    title: "Vibe Crashed",
    message: "This vibe crashed while running.",
    suggestion: "The creator may need to fix a bug in the code.",
  },
  // Policy violation
  "E-VIBECODR-2120": {
    title: "Storage Blocked",
    message: "Browser storage is disabled for security.",
    suggestion: "This vibe tried to use localStorage which is not allowed.",
  },
  "E-VIBECODR-2121": {
    title: "Cookies Blocked",
    message: "Cookie access is disabled for security.",
    suggestion: "This vibe tried to access cookies which is not allowed.",
  },
  "E-VIBECODR-2122": {
    title: "Navigation Blocked",
    message: "Navigation is disabled for security.",
    suggestion: "This vibe tried to navigate away which is not allowed.",
  },
  // Bundle reference missing
  "E-VIBECODR-0504": {
    title: "Bundle Missing",
    message: "The bundle reference is missing for this vibe.",
    suggestion: "The vibe may not have been compiled correctly.",
  },
  // Bundle not found
  "E-VIBECODR-0505": {
    title: "Bundle Not Found",
    message: "The compiled bundle could not be found.",
    suggestion: "The vibe may have been deleted or is still processing.",
  },
};

const DEFAULT_ERROR: RuntimeErrorInfo = {
  title: "Failed to Load",
  message: "Something went wrong while loading this vibe.",
  suggestion: "Please try again later.",
};

/**
 * Extract error code from an error message string.
 * Looks for E-VIBECODR-XXXX pattern.
 */
export function extractErrorCode(message: string | undefined): string | null {
  if (!message) return null;
  const match = message.match(/E-VIBECODR-\d{4}/);
  return match ? match[0] : null;
}

/**
 * Get user-friendly error info for a runtime error.
 * Accepts either an error code or a raw error message.
 */
export function getRuntimeErrorInfo(errorOrCode: string | undefined): RuntimeErrorInfo {
  if (!errorOrCode) return DEFAULT_ERROR;

  // Check if it's a direct error code
  if (errorOrCode in RUNTIME_ERROR_MAP) {
    return RUNTIME_ERROR_MAP[errorOrCode];
  }

  // Try to extract error code from message
  const code = extractErrorCode(errorOrCode);
  if (code && code in RUNTIME_ERROR_MAP) {
    return RUNTIME_ERROR_MAP[code];
  }

  // Check for common patterns in error messages
  if (errorOrCode.toLowerCase().includes("boot timeout")) {
    return {
      title: "Startup Timeout",
      message: "This vibe took too long to start.",
      suggestion: "The vibe may be too complex or have an infinite loop.",
    };
  }

  if (errorOrCode.toLowerCase().includes("policy violation")) {
    return {
      title: "Policy Violation",
      message: "This vibe violated a security policy.",
      suggestion: "Some features are disabled for safety.",
    };
  }

  return DEFAULT_ERROR;
}

/**
 * Format error for display in Player UI.
 * Returns a formatted string with title and message.
 */
export function formatRuntimeError(errorOrCode: string | undefined): string {
  const info = getRuntimeErrorInfo(errorOrCode);
  return info.message;
}
