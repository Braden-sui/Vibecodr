let syncedOnce = false;
let inFlight: Promise<void> | null = null;

const ERROR_PREFIX = "E-VIBECODR-0401 user sync failed";

async function postSyncRequest(): Promise<void> {
  const response = await fetch("/api/users/sync", { method: "POST" });
  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.error === "function") {
        console.error("E-VIBECODR-0402 user sync error body read failed", {
          status: response.status,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    throw new Error(`${ERROR_PREFIX}: ${response.status} ${body ?? ""}`.trim());
  }
}

export async function ensureUserSynced(): Promise<void> {
  if (syncedOnce) {
    return;
  }
  if (typeof window === "undefined") {
    // Server-rendered environments rely on upstream sync (Next API routes require cookies).
    return;
  }

  if (!inFlight) {
    inFlight = postSyncRequest().catch((error) => {
      console.error(ERROR_PREFIX, error);
      throw error;
    });
  }

  try {
    await inFlight;
    syncedOnce = true;
  } finally {
    if (inFlight) {
      // Allow retries if another caller invokes after completion.
      inFlight = null;
    }
  }
}

export function __resetUserSyncForTests() {
  syncedOnce = false;
  inFlight = null;
}
