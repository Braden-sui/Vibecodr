"use client";

import { AlertCircle, FileDown, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Issue = { path: string; message: string };

interface ManifestErrorActionsProps {
  message?: string;
  errors: Issue[];
  onDownloadManifest?: () => void;
  onOpenEditor?: () => void;
  onResetManifest?: () => void;
  disableActions?: boolean;
  canDownload?: boolean;
}

export function ManifestErrorActions({
  message,
  errors,
  onDownloadManifest,
  onOpenEditor,
  onResetManifest,
  disableActions,
  canDownload,
}: ManifestErrorActionsProps) {
  const topIssues = errors.slice(0, 3);
  const remainingCount = Math.max(0, errors.length - topIssues.length);

  return (
    <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold text-destructive">Manifest needs fixes</p>
          <p className="text-xs text-muted-foreground">
            {message ?? "We found manifest issues. Resolve them or try a quick action."}
          </p>
        </div>
      </div>

      <ul className="list-disc space-y-1 pl-6">
        {topIssues.map((issue, idx) => (
          <li key={`${issue.path}-${idx}`}>
            <span className="font-mono text-[11px] text-destructive/80">{issue.path || "manifest"}</span>:{" "}
            <span className="text-destructive">{issue.message}</span>
          </li>
        ))}
      </ul>
      {remainingCount > 0 && (
        <p className="text-xs text-muted-foreground">+{remainingCount} more issues listed below.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={onDownloadManifest}
          disabled={!onDownloadManifest || disableActions || !canDownload}
        >
          <FileDown className="mr-2 h-4 w-4" />
          Download manifest.json
        </Button>
        <Button size="sm" variant="outline" onClick={onOpenEditor} disabled={!onOpenEditor || disableActions}>
          <Pencil className="mr-2 h-4 w-4" />
          Open in Studio to edit
        </Button>
        <Button size="sm" variant="ghost" onClick={onResetManifest} disabled={!onResetManifest || disableActions}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset to default manifest
        </Button>
      </div>
    </div>
  );
}

export function InlineError({ message }: { message: string }) {
  return <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{message}</div>;
}
