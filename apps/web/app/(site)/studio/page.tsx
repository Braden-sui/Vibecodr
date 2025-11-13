"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StudioShell } from "@/components/Studio/StudioShell";
import { ImportTab } from "@/components/Studio/ImportTab";
import { ParamsTab } from "@/components/Studio/ParamsTab";
import { FilesTab } from "@/components/Studio/FilesTab";
import { PublishTab } from "@/components/Studio/PublishTab";
import type { CapsuleDraft } from "@/components/Studio/StudioShell";

/**
 * Studio Index - Main capsule creation workflow
 * Tabs: Import → Params → Files → Publish
 * Based on mvp-plan.md Phase 2 Studio requirements
 */
export default function StudioIndex() {
  const router = useRouter();
  const [currentTab, setCurrentTab] = useState<"import" | "params" | "files" | "publish">(
    "import"
  );

  // TODO: Load draft from localStorage or API
  const [draft, setDraft] = useState<CapsuleDraft | undefined>(undefined);

  const handleTabChange = (tab: string) => {
    setCurrentTab(tab as any);
  };

  return (
    <StudioShell currentTab={currentTab} draft={draft} onTabChange={handleTabChange}>
      {currentTab === "import" && <ImportTab />}
      {currentTab === "params" && <ParamsTab />}
      {currentTab === "files" && <FilesTab />}
      {currentTab === "publish" && <PublishTab />}
    </StudioShell>
  );
}

