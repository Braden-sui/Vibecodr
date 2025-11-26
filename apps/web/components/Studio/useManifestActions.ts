"use client";

import { useCallback } from "react";
import { createDefaultManifest, type Manifest, type RunnerType } from "@vibecodr/shared/manifest";
import type { CapsuleDraft } from "./StudioShell";

type Navigate = (tab: string) => void;

export function useManifestActions(options: {
  draft?: CapsuleDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<CapsuleDraft | undefined>>;
  onNavigateToTab?: Navigate;
}) {
  const { draft, onDraftChange, onNavigateToTab } = options;

  const downloadManifest = useCallback(() => {
    if (!draft?.manifest) return;
    const blob = new Blob([JSON.stringify(draft.manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "manifest.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [draft?.manifest]);

  const openManifestEditor = useCallback(() => {
    onNavigateToTab?.("files");
  }, [onNavigateToTab]);

  const resetManifest = useCallback(
    (options?: { runnerFallback?: RunnerType; onAfterReset?: () => void }) => {
      const fallbackRunner: RunnerType = options?.runnerFallback ?? "client-static";
      onDraftChange((prev) => {
        const runner: RunnerType = prev?.manifest?.runner ?? fallbackRunner;
        const nextManifest: Manifest = createDefaultManifest(runner);
        if (!prev) {
          return {
            id: crypto.randomUUID(),
            manifest: nextManifest,
            files: undefined,
            sourceZipName: undefined,
            validationStatus: "valid",
            validationWarnings: [],
            validationErrors: [],
            buildStatus: "idle",
            artifact: null,
            publishStatus: "idle",
            postId: undefined,
          };
        }
        return {
          ...prev,
          manifest: nextManifest,
          validationStatus: "valid",
          validationWarnings: [],
          validationErrors: [],
          buildStatus: prev.buildStatus ?? "idle",
        };
      });
      options?.onAfterReset?.();
    },
    [onDraftChange]
  );

  return {
    downloadManifest,
    openManifestEditor,
    resetManifest,
    canDownload: Boolean(draft?.manifest),
  };
}
