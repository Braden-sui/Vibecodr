"use client";

import { cn } from "@/lib/utils";
import type { StudioTab } from "./Studio/StudioShell";

const TABS: Array<{ label: string; value: StudioTab }> = [
  { label: "Import", value: "import" },
  { label: "Params", value: "params" },
  { label: "Files", value: "files" },
  { label: "Publish", value: "publish" },
];

export interface StudioNavProps {
  currentTab: StudioTab;
  onTabChange?: (tab: StudioTab) => void;
}

export function StudioNav({ currentTab, onTabChange }: StudioNavProps) {
  return (
    <nav className="flex flex-wrap items-center gap-2 border-b border-border bg-card/80 px-4 py-2 text-sm font-semibold">
      {TABS.map((tab) => {
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
