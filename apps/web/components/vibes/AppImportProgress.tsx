'use client';

import { AlertCircle, Check, Loader2, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppProgressState, AppProgressStep } from "./useAppImport";

const PROGRESS_STEPS: Array<{ key: AppProgressStep; label: string; helper?: string }> = [
  { key: "select", label: "Source", helper: "Choose GitHub, ZIP, or inline code" },
  { key: "upload", label: "Upload", helper: "Send files to the builder" },
  { key: "analyze", label: "Analyze", helper: "Inspect manifest + dependencies" },
  { key: "build", label: "Build", helper: "Bundle and prepare capsule" },
  { key: "ready", label: "Ready", helper: "Attach app to your post" },
];

const PROGRESS_ORDER: AppProgressStep[] = PROGRESS_STEPS.map((step) => step.key);

const deriveStepState = (
  step: AppProgressStep,
  progress: AppProgressState,
  isAttached: boolean,
): "done" | "active" | "pending" | "error" => {
  if (isAttached || progress.status === "ready") {
    return "done";
  }
  if (progress.status === "error" && progress.active === step) {
    return "error";
  }
  if (progress.status === "idle") {
    return step === "select" ? "active" : "pending";
  }
  const activeIndex = PROGRESS_ORDER.indexOf(progress.active);
  const stepIndex = PROGRESS_ORDER.indexOf(step);
  if (stepIndex < activeIndex) return "done";
  if (stepIndex === activeIndex) return progress.status === "processing" ? "active" : "pending";
  return "pending";
};

type AppImportProgressProps = {
  progress: AppProgressState;
  hasAttachedApp: boolean;
  className?: string;
};

export function AppImportProgress({ progress, hasAttachedApp, className }: AppImportProgressProps) {
  const progressForDisplay: AppProgressState = hasAttachedApp
    ? { status: "ready", active: "ready", message: "App attached" }
    : progress;

  return (
    <div className={cn("grid gap-2 rounded-md bg-muted/40 p-3", className)}>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        {PROGRESS_STEPS.map((step) => {
          const state = deriveStepState(step.key, progressForDisplay, hasAttachedApp);
          const isError = state === "error";
          const isDone = state === "done";
          const isActive = state === "active";
          const icon = isError ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : isDone ? (
            <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
          ) : isActive ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Minus className="h-4 w-4 text-muted-foreground" />
          );

          return (
            <div
              key={step.key}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-2",
                isError
                  ? "border-destructive/50 bg-destructive/10"
                  : isDone
                    ? "border-green-500/40 bg-green-500/5"
                    : isActive
                      ? "border-primary/40 bg-primary/5"
                      : "border-muted bg-background",
              )}
            >
              {icon}
              <div className="min-w-0">
                <p className="text-xs font-medium leading-tight">{step.label}</p>
                <p className="text-[11px] leading-tight text-muted-foreground">{step.helper}</p>
              </div>
            </div>
          );
        })}
      </div>
      {progressForDisplay.message && <p className="text-xs text-muted-foreground">{progressForDisplay.message}</p>}
    </div>
  );
}
