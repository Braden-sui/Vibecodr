"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type PlayerConsoleEntry = {
  id: string;
  level: "log" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
  source: "preview" | "player";
};

interface PlayerConsoleProps {
  entries: PlayerConsoleEntry[];
  collapsed: boolean;
  onToggle: () => void;
  onClear?: () => void;
}

const LEVEL_STYLES: Record<PlayerConsoleEntry["level"], string> = {
  log: "text-muted-foreground",
  info: "text-blue-500",
  warn: "text-amber-500",
  error: "text-destructive",
};

export const PlayerConsole = memo(function PlayerConsole({
  entries,
  collapsed,
  onToggle,
  onClear,
}: PlayerConsoleProps) {
  return (
    <div className="border-t bg-card/80">
      <div className="flex items-center justify-between px-4 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Console
          <Badge variant="secondary" className="text-xs font-normal">
            {entries.length} log{entries.length === 1 ? "" : "s"}
          </Badge>
        </button>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px] uppercase tracking-wide">
            Live
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            onClick={onClear}
            disabled={entries.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>
      {!collapsed && (
        <div className="max-h-56 overflow-y-auto bg-background px-4 pb-3 pt-2 font-mono text-xs text-muted-foreground">
          {entries.length === 0 ? (
            <p className="text-muted-foreground">No logs yet. Interact with the vibe to see output.</p>
          ) : (
            <ul className="space-y-1.5">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className={cn("flex gap-3 whitespace-pre-wrap", LEVEL_STYLES[entry.level])}
                >
                  <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span className="w-12 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {entry.source}
                  </span>
                  <span className="shrink-0 text-[11px] uppercase tracking-wide">{entry.level}</span>
                  <span className="flex-1">{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});
