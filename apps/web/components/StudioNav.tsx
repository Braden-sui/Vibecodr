"use client";

import { cn } from "@/lib/utils";
import type { StudioTab } from "./Studio/StudioShell";

const PRIMARY_TABS: Array<{ label: string; value: StudioTab }> = [
  { label: "Import", value: "import" },
  { label: "Publish", value: "publish" },
];

const ADVANCED_TABS: Array<{ label: string; value: StudioTab }> = [
  { label: "Params", value: "params" },
  { label: "Files", value: "files" },
];

export interface StudioNavProps {
  currentTab: StudioTab;
  onTabChange?: (tab: StudioTab) => void;
  showAdvanced?: boolean;
}

export function StudioNav({ currentTab, onTabChange, showAdvanced = false }: StudioNavProps) {
  const tabs = showAdvanced ? [...PRIMARY_TABS, ...ADVANCED_TABS] : PRIMARY_TABS;

  return (
    <nav className="flex flex-wrap items-center gap-2 border-b border-border bg-card/80 px-4 py-2 text-sm font-semibold">
      {tabs.map((tab) => {
        const active = tab.value === currentTab;
        return (
          <button
            key={tab.value}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onTabChange?.(tab.value)}
            className={cn(
              "rounded-full px-3 py-1 transition",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
