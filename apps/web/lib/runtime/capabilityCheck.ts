/**
 * SOTP Decision: Feature capability detection for sandboxed iframes
 *
 * Checks which browser APIs are available in the current execution context.
 * Used to detect missing capabilities before enabling capsule preview.
 *
 * The sandbox attribute "allow-scripts" blocks:
 * - Same-origin access (localStorage, cookies, parent window APIs)
 * - Form submission
 * - Pointer lock, orientation lock
 * - Modal dialogs (alert, confirm, prompt)
 * - Top navigation
 *
 * This check runs inside the sandboxed iframe to detect available features.
 */

export type CapabilityCheckResult = {
  available: string[];
  unavailable: string[];
  warnings: string[];
};

/**
 * Check which capabilities are available in the current context.
 * Call this inside a sandboxed iframe to detect what's blocked.
 */
export function checkCapabilities(): CapabilityCheckResult {
  const available: string[] = [];
  const unavailable: string[] = [];
  const warnings: string[] = [];

  // Check localStorage access
  try {
    const testKey = "__vibecodr_cap_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    available.push("localStorage");
  } catch {
    unavailable.push("localStorage");
    // Expected in sandbox without allow-same-origin
  }

  // Check sessionStorage access
  try {
    const testKey = "__vibecodr_cap_test__";
    sessionStorage.setItem(testKey, "1");
    sessionStorage.removeItem(testKey);
    available.push("sessionStorage");
  } catch {
    unavailable.push("sessionStorage");
  }

  // Check cookie access
  try {
    const testCookie = "__vibecodr_cap_test__=1";
    document.cookie = testCookie;
    const hasCookie = document.cookie.includes("__vibecodr_cap_test__");
    if (hasCookie) {
      available.push("cookies");
      // Clear test cookie
      document.cookie = "__vibecodr_cap_test__=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    } else {
      unavailable.push("cookies");
    }
  } catch {
    unavailable.push("cookies");
  }

  // Check postMessage to parent (should always work)
  try {
    if (window.parent && window.parent !== window) {
      available.push("postMessage");
    } else {
      unavailable.push("postMessage");
      warnings.push("Not running in an iframe context");
    }
  } catch {
    unavailable.push("postMessage");
    warnings.push("postMessage access blocked");
  }

  // Check fetch API
  try {
    if (typeof fetch === "function") {
      available.push("fetch");
    } else {
      unavailable.push("fetch");
    }
  } catch {
    unavailable.push("fetch");
  }

  // Check if we can access parent origin (blocked with sandbox)
  try {
    // This will throw in a sandboxed iframe without allow-same-origin
    const parentOrigin = window.parent.location.origin;
    available.push("parentOriginAccess");
    warnings.push(`Parent origin accessible: ${parentOrigin}`);
  } catch {
    unavailable.push("parentOriginAccess");
    // Expected - this is the secure default
  }

  // Check requestAnimationFrame
  try {
    if (typeof requestAnimationFrame === "function") {
      available.push("requestAnimationFrame");
    } else {
      unavailable.push("requestAnimationFrame");
    }
  } catch {
    unavailable.push("requestAnimationFrame");
  }

  // Check canvas
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      available.push("canvas2d");
    } else {
      unavailable.push("canvas2d");
    }
  } catch {
    unavailable.push("canvas2d");
  }

  // Check WebGL
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      available.push("webgl");
    } else {
      unavailable.push("webgl");
    }
  } catch {
    unavailable.push("webgl");
  }

  return { available, unavailable, warnings };
}

/**
 * Reports capability check results to the parent frame via postMessage.
 * Designed to be called early in capsule initialization.
 */
export function reportCapabilities(): void {
  const result = checkCapabilities();

  try {
    window.parent.postMessage(
      {
        type: "capabilityCheck",
        payload: result,
        source: "vibecodr-capsule",
      },
      "*" // Use wildcard since we may not know parent origin
    );
  } catch (error) {
    console.error("E-VIBECODR-2130 failed to report capabilities", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Validates that required capabilities are available.
 * Returns an error message if any required capability is missing.
 */
export function validateRequiredCapabilities(
  result: CapabilityCheckResult,
  required: string[]
): string | null {
  const missing = required.filter((cap) => result.unavailable.includes(cap));

  if (missing.length === 0) {
    return null;
  }

  return `Missing required capabilities: ${missing.join(", ")}`;
}
