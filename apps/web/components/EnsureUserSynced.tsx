"use client";

import { useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { ensureUserSynced } from "@/lib/user-sync";

export function EnsureUserSynced() {
  const { isSignedIn } = useUser();
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!isSignedIn) {
      syncingRef.current = false;
      return;
    }
    if (syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    ensureUserSynced().catch(() => {
      // Allow retries if sync fails (e.g., transient network issue).
      syncingRef.current = false;
    });
  }, [isSignedIn]);

  return null;
}
