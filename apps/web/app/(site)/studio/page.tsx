"use client";

import { useState } from "react";
import { StudioNav } from "@/components/StudioNav";
import { StudioShell, type StudioTab } from "@/components/Studio/StudioShell";
import { ImportTab } from "@/components/Studio/ImportTab";
import { ParamsTab } from "@/components/Studio/ParamsTab";
import { FilesTab } from "@/components/Studio/FilesTab";
import { PublishTab } from "@/components/Studio/PublishTab";
import type { CapsuleDraft } from "@/components/Studio/StudioShell";

// NOTE: Studio UI remains in the codebase but is not currently linked from navigation; VibesComposer is the active path.

/**
 * Studio Index - Main vibe creation workflow
 * Tabs: Import + Publish (Params/Files available with ?advanced=1)
 * Based on mvp-plan.md Phase 2 Studio requirements
 */
export default function StudioIndex() {
  const [currentTab, setCurrentTab] = useState<StudioTab>("import");
  const [draft, setDraft] = useState<CapsuleDraft | undefined>();
  const [showAdvanced] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("advanced") === "1";
  });

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
      <StudioNav currentTab={currentTab} onTabChange={handleTabChange} showAdvanced={showAdvanced} />
      <StudioShell currentTab={currentTab} draft={draft} onTabChange={handleTabChange} showAdvanced={showAdvanced}>
        {currentTab === "import" && (
          <ImportTab draft={draft} onDraftChange={setDraft} onNavigateToTab={handleTabChange} />
        )}
        {currentTab === "params" && showAdvanced && <ParamsTab />}
        {currentTab === "files" && showAdvanced && <FilesTab />}
        {currentTab === "publish" && <PublishTab draft={draft} onDraftChange={setDraft} />}
      </StudioShell>
    </div>
  );
}

