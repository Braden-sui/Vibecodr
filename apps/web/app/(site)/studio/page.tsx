"use client";

import { useState } from "react";
import { StudioShell } from "@/components/Studio/StudioShell";
import { ImportTab } from "@/components/Studio/ImportTab";
import { ParamsTab } from "@/components/Studio/ParamsTab";
import { FilesTab } from "@/components/Studio/FilesTab";
import { PublishTab } from "@/components/Studio/PublishTab";
import type { CapsuleDraft } from "@/components/Studio/StudioShell";

type StudioTab = "import" | "params" | "files" | "publish";

/**
 * Studio Index - Main vibe creation workflow
 * Tabs: Import → Params → Files → Publish
 * Based on mvp-plan.md Phase 2 Studio requirements
 */
export default function StudioIndex() {
  const [currentTab, setCurrentTab] = useState<StudioTab>("import");
  const [draft, setDraft] = useState<CapsuleDraft | undefined>();

  const handleTabChange = (tab: string) => {
    if (tab === "import" || tab === "params" || tab === "files" || tab === "publish") {
      setCurrentTab(tab);
    }
  };

  return (
    <StudioShell currentTab={currentTab} draft={draft} onTabChange={handleTabChange}>
      {currentTab === "import" && (
        <ImportTab draft={draft} onDraftChange={setDraft} onNavigateToTab={handleTabChange} />
      )}
      {currentTab === "params" && <ParamsTab />}
      {currentTab === "files" && <FilesTab />}
      {currentTab === "publish" && <PublishTab draft={draft} onDraftChange={setDraft} />}
    </StudioShell>
  );
}
