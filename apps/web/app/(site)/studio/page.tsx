"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { StudioNav } from "@/components/StudioNav";
import { StudioShell, type StudioTab } from "@/components/Studio/StudioShell";
import { ImportTab } from "@/components/Studio/ImportTab";
import { ParamsTab } from "@/components/Studio/ParamsTab";
import { FilesTab } from "@/components/Studio/FilesTab";
import { PublishTab } from "@/components/Studio/PublishTab";
import type { CapsuleDraft } from "@/components/Studio/StudioShell";
import { capsulesApi } from "@/lib/api";
import { trackClientError } from "@/lib/analytics";
import { inferContentType } from "@/lib/contentType";

// NOTE: Studio UI remains in the codebase but is not currently linked from navigation; VibesComposer is the active path.

/**
 * Studio Index - Main vibe creation workflow
 * Tabs: Import + Publish (Params/Files available with ?advanced=1)
 * Based on mvp-plan.md Phase 2 Studio requirements
 */
export default function StudioIndex() {
  const [searchParams] = useSearchParams();
  const [currentTab, setCurrentTab] = useState<StudioTab>("import");
  const [draft, setDraft] = useState<CapsuleDraft | undefined>();
  const [isHydrating, setIsHydrating] = useState(false);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const { getToken } = useAuth();

  const capsuleIdFromQuery = useMemo(() => searchParams.get("capsuleId") ?? null, [searchParams]);
  const showAdvanced = useMemo(
    () => searchParams.get("advanced") === "1" || Boolean(capsuleIdFromQuery),
    [capsuleIdFromQuery, searchParams]
  );

  const buildAuthInit = useCallback(async (): Promise<RequestInit | undefined> => {
    if (typeof getToken !== "function") return undefined;
    const token = await getToken({ template: "workers" });
    if (!token) return undefined;
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  }, [getToken]);

  useEffect(() => {
    if (!capsuleIdFromQuery || draft?.capsuleId === capsuleIdFromQuery) {
      return;
    }

    let cancelled = false;
    const hydrateFromCapsule = async () => {
      setIsHydrating(true);
      setHydrateError(null);
      try {
        const init = await buildAuthInit();
        const response = await capsulesApi.filesSummary(capsuleIdFromQuery, init);
        if (!response.ok) {
          const body = (await safeJson(response)) as { error?: string };
          throw new Error(body?.error || `Failed to load capsule ${capsuleIdFromQuery}`);
        }
        const summary = (await response.json()) as {
          capsuleId: string;
          manifest: CapsuleDraft["manifest"];
          files: Array<{ path: string; size?: number }>;
        };
        if (cancelled) return;

        setDraft({
          id: capsuleIdFromQuery,
          capsuleId: capsuleIdFromQuery,
          manifest: summary.manifest,
          files:
            summary.files?.map((file) => ({
              path: file.path,
              size: file.size ?? 0,
              type: inferContentType(file.path),
            })) ?? [],
          validationStatus: "valid",
          validationErrors: undefined,
          validationWarnings: undefined,
          buildStatus: "idle",
          artifact: null,
          publishStatus: "idle",
          postId: undefined,
        });
        setCurrentTab("files");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load capsule";
        setHydrateError(message);
        trackClientError("E-VIBECODR-0901", {
          area: "studio.hydrate",
          capsuleId: capsuleIdFromQuery,
          message,
        });
      } finally {
        if (!cancelled) {
          setIsHydrating(false);
        }
      }
    };

    void hydrateFromCapsule();
    return () => {
      cancelled = true;
    };
  }, [buildAuthInit, capsuleIdFromQuery, draft?.capsuleId]);

  const handleTabChange = (tab: string) => {
    if (tab === "import" || tab === "publish") {
      setCurrentTab(tab);
      return;
    }
    if (showAdvanced && (tab === "params" || tab === "files")) {
      setCurrentTab(tab);
    }
  };

  return (
    <div className="space-y-6">
      {hydrateError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {hydrateError}
        </div>
      )}
      <StudioNav currentTab={currentTab} onTabChange={handleTabChange} showAdvanced={showAdvanced} />
      <StudioShell
        currentTab={currentTab}
        draft={draft}
        onTabChange={handleTabChange}
        showAdvanced={showAdvanced}
      >
        {currentTab === "import" && (
          <ImportTab
            draft={draft}
            onDraftChange={setDraft}
            onNavigateToTab={handleTabChange}
            buildAuthInit={buildAuthInit}
          />
        )}
        {currentTab === "params" && showAdvanced && (
          <ParamsTab draft={draft} onDraftChange={setDraft} buildAuthInit={buildAuthInit} />
        )}
        {currentTab === "files" && showAdvanced && (
          <FilesTab draft={draft} onDraftChange={setDraft} buildAuthInit={buildAuthInit} isHydrating={isHydrating} />
        )}
        {currentTab === "publish" && <PublishTab draft={draft} onDraftChange={setDraft} />}
      </StudioShell>
    </div>
  );
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

