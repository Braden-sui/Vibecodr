import { getWorkerApiBase } from "@/lib/worker-api";

let syncedOnce = false;
let inFlight: Promise<void> | null = null;

const ERROR_PREFIX = "E-VIBECODR-0401 user sync failed";

export type SyncUserPayload = {
  id: string;
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  bio?: string | null;
  plan?: string | null;
};

export type EnsureUserSyncedInput = {
  user: SyncUserPayload;
  token: string;
};

async function postSyncRequest(input: EnsureUserSyncedInput): Promise<void> {
  const { user, token } = input;
  const response = await fetch(`${getWorkerApiBase()}/users/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(user),
  });
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

export async function ensureUserSynced(input: EnsureUserSyncedInput): Promise<void> {
  if (syncedOnce) {
    return;
  }
  if (typeof window === "undefined") {
    // Server-rendered environments rely on upstream sync.
    return;
  }

  if (!inFlight) {
    inFlight = postSyncRequest(input).catch((error) => {
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
