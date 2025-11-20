"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2, FileCode, Sliders, Upload, Send } from "lucide-react";
import type { Manifest } from "@vibecodr/shared/manifest";

export interface DraftFile {
  path: string;
  type: string;
  size: number;
  file: File;
}

export interface DraftArtifact {
  id?: string;
  runtimeVersion?: string | null;
  bundleDigest?: string | null;
  bundleSizeBytes?: number | null;
  status?: "pending" | "queued" | "ready" | "failed";
}

export interface CapsuleDraft {
  id: string;
  manifest?: Manifest;
  files?: DraftFile[];
  sourceZipName?: string;
  validationStatus: "idle" | "validating" | "valid" | "invalid";
  validationErrors?: Array<{ path: string; message: string }>;
  validationWarnings?: Array<{ path: string; message: string }>;
  buildStatus: "idle" | "building" | "success" | "failed";
  artifact?: DraftArtifact | null;
  capsuleId?: string;
  publishStatus?: "idle" | "publishing" | "success" | "error";
  postId?: string;
}

export type StudioTab = "import" | "params" | "files" | "publish";

export interface StudioShellProps {
  children: React.ReactNode;
  currentTab: StudioTab;
  draft?: CapsuleDraft;
  onTabChange?: (tab: string) => void;
}

/**
 * Studio Shell - Main container for vibe creation workflow
 * Provides tab navigation and validation status display
 * Based on mvp-plan.md Studio section
 */
export function StudioShell({ children, currentTab, draft, onTabChange }: StudioShellProps) {
  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Header with Status */}
      <div className="border-b bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
              <h1 className="text-2xl font-bold">Studio</h1>
              <p className="text-sm text-muted-foreground">
                Create and publish runnable vibes
              </p>
          </div>

          {/* Validation Status */}
          {draft && (
            <div className="flex items-center gap-3">
              {draft.validationStatus === "validating" && (
                <Badge variant="secondary" className="gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Validating...
                </Badge>
              )}
              {draft.validationStatus === "valid" && (
                <Badge variant="default" className="gap-2 bg-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  Valid
                </Badge>
              )}
              {draft.validationStatus === "invalid" && (
                <Badge variant="destructive" className="gap-2">
                  <AlertCircle className="h-3 w-3" />
                  {draft.validationErrors?.length || 0} Errors
                </Badge>
              )}

              {draft.buildStatus === "building" && (
                <Badge variant="secondary" className="gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Building...
                </Badge>
              )}
              {draft.buildStatus === "success" && (
                <Badge variant="default" className="gap-2 bg-blue-600">
                  <CheckCircle2 className="h-3 w-3" />
                  Built
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <Tabs value={currentTab} onValueChange={onTabChange} className="flex flex-1 flex-col">
        <div className="border-b bg-muted/50">
          <TabsList className="h-14 w-full justify-start rounded-none border-0 bg-transparent p-0">
            <TabsTrigger
              value="import"
              className="relative h-14 rounded-none border-b-2 border-transparent px-6 data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              <Upload className="mr-2 h-4 w-4" />
              Import
            </TabsTrigger>
            <TabsTrigger
              value="params"
              className="relative h-14 rounded-none border-b-2 border-transparent px-6 data-[state=active]:border-primary data-[state=active]:bg-transparent"
              disabled={!draft?.manifest}
            >
              <Sliders className="mr-2 h-4 w-4" />
              Params
            </TabsTrigger>
            <TabsTrigger
              value="files"
              className="relative h-14 rounded-none border-b-2 border-transparent px-6 data-[state=active]:border-primary data-[state=active]:bg-transparent"
              disabled={!draft?.manifest}
            >
              <FileCode className="mr-2 h-4 w-4" />
              Files
            </TabsTrigger>
            <TabsTrigger
              value="publish"
              className="relative h-14 rounded-none border-b-2 border-transparent px-6 data-[state=active]:border-primary data-[state=active]:bg-transparent"
              disabled={!draft?.manifest || draft.validationStatus === "invalid"}
            >
              <Send className="mr-2 h-4 w-4" />
              Publish
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto">{children}</div>
      </Tabs>

      {/* Validation Errors Panel (if any) */}
      {draft?.validationStatus === "invalid" && draft.validationErrors && (
        <div className="border-t bg-destructive/10 p-4">
          <div className="space-y-2">
            <h3 className="flex items-center gap-2 font-semibold text-destructive">
              <AlertCircle className="h-4 w-4" />
              Validation Errors
            </h3>
            <div className="space-y-1">
              {draft.validationErrors.slice(0, 3).map((error, i) => (
                <div key={i} className="text-sm text-muted-foreground">
                  <span className="font-mono text-xs">{error.path}</span>: {error.message}
                </div>
              ))}
              {draft.validationErrors.length > 3 && (
                <div className="text-sm text-muted-foreground">
                  +{draft.validationErrors.length - 3} more errors
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Validation Warnings (if any) */}
      {draft?.validationWarnings && draft.validationWarnings.length > 0 && (
        <div className="border-t bg-yellow-500/10 p-4">
          <div className="space-y-2">
            <h3 className="flex items-center gap-2 font-semibold text-yellow-700 dark:text-yellow-500">
              <AlertCircle className="h-4 w-4" />
              Warnings
            </h3>
            <div className="space-y-1">
              {draft.validationWarnings.slice(0, 2).map((warning, i) => (
                <div key={i} className="text-sm text-muted-foreground">
                  <span className="font-mono text-xs">{warning.path}</span>: {warning.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
