'use client';

import { Code, Github, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppComposerMode } from "./useAppImport";

type AppSourceSelectorProps = {
  appMode: AppComposerMode;
  onSelect: (mode: AppComposerMode) => void;
  disabled?: boolean;
  className?: string;
};

export function AppSourceSelector({ appMode, onSelect, disabled, className }: AppSourceSelectorProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button
        type="button"
        variant={appMode === "github" ? "default" : "outline"}
        size="sm"
        className="gap-1"
        onClick={() => onSelect("github")}
        disabled={disabled}
      >
        <Github className="h-3 w-3" />
        GitHub
      </Button>
      <Button
        type="button"
        variant={appMode === "zip" ? "default" : "outline"}
        size="sm"
        className="gap-1"
        onClick={() => onSelect("zip")}
        disabled={disabled}
      >
        <Upload className="h-3 w-3" />
        ZIP
      </Button>
      <Button
        type="button"
        variant={appMode === "code" ? "default" : "outline"}
        size="sm"
        className="gap-1"
        onClick={() => onSelect("code")}
        disabled={disabled}
      >
        <Code className="h-3 w-3" />
        Code
      </Button>
    </div>
  );
}
