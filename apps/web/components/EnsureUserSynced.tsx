"use client";

import { useEffect, useRef } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { ensureUserSynced, type SyncUserPayload } from "@/lib/user-sync";

export function EnsureUserSynced() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { isLoaded: isAuthLoaded, getToken } = useAuth();
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isAuthLoaded) {
      return;
    }
    if (!isSignedIn || !user) {
      syncingRef.current = false;
      return;
    }
    if (syncingRef.current) {
      return;
    }
    const run = async () => {
      syncingRef.current = true;
      try {
        const token = getToken ? await getToken({ template: "workers" }) : null;
        if (!token) {
          syncingRef.current = false;
          return;
        }

        const payload: SyncUserPayload = {
          id: user.id,
          handle: user.username || `user_${user.id.slice(0, 8)}`,
          name:
            user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : null,
          avatarUrl: user.imageUrl,
          bio: null,
          plan: undefined,
        };

        await ensureUserSynced({ user: payload, token });
      } catch {
        // Allow retries if sync fails (e.g., transient network issue).
        syncingRef.current = false;
      }
    };

    void run();
  }, [getToken, isAuthLoaded, isLoaded, isSignedIn, user]);

  return null;
}
