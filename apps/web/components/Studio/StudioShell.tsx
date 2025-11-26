"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2, FileCode, Sliders, Upload, Send } from "lucide-react";
import type { Manifest } from "@vibecodr/shared/manifest";
import type { DraftCapsule, ArtifactSummary, ValidationIssue } from "@vibecodr/shared";
import { ManifestErrorActions } from "./ManifestErrorActions";

/**
 * Local file reference for client-side editing
 */
export interface DraftFile {
  path: string;
  type?: string;
  size: number;
  file?: File;
}

/**
 * Runtime artifact info - extends shared ArtifactSummary with status
 * Compatible with server's artifact response shape
 */
export interface DraftArtifact extends Partial<ArtifactSummary> {
  id?: string;
  status?: "pending" | "queued" | "ready" | "failed";
}

/**
 * CapsuleDraft - Client-side state for a draft capsule.
 * Extends the shared DraftCapsule contract with UI-specific fields.
 *
 * Core fields (from DraftCapsule contract):
 *   - capsuleId: Server-assigned capsule ID
 *   - manifest: The capsule manifest
 *   - contentHash, totalSize, fileCount, entryPoint, entryCandidates
 *   - artifact: Runtime artifact info
 *   - warnings, errors: Validation issues
 *
 * UI-specific fields:
 *   - id: Local draft ID for React state management
 *   - files: Local file references (client-side only)
 *   - sourceZipName: Original import source name
 *   - validationStatus, buildStatus, publishStatus: UI state machines
 *   - postId: Created post ID after publish
 */
export interface CapsuleDraft {
  // Local state ID (for React key/state management)
  id: string;

  // Core DraftCapsule fields (optional until import/publish)
  capsuleId?: string;
  manifest?: Manifest;
  contentHash?: string;
  totalSize?: number;
  fileCount?: number;
  entryPoint?: string;
  entryCandidates?: string[];
  artifact?: DraftArtifact | null;

  // Validation issues (shared type)
  validationErrors?: ValidationIssue[];
  validationWarnings?: ValidationIssue[];

  // Client-only fields
  files?: DraftFile[];
  sourceZipName?: string;
  sourceName?: string;

  // UI state machines
  validationStatus: "idle" | "validating" | "valid" | "invalid";
  buildStatus: "idle" | "building" | "success" | "failed";
  publishStatus?: "idle" | "publishing" | "success" | "error";
  postId?: string;
}

/**
 * Create a CapsuleDraft from a DraftCapsule (server response)
 */
export function fromDraftCapsule(draft: DraftCapsule, localId?: string): CapsuleDraft {
  return {
    id: localId ?? crypto.randomUUID(),
    capsuleId: draft.capsuleId,
    manifest: draft.manifest,
    contentHash: draft.contentHash,
    totalSize: draft.totalSize,
    fileCount: draft.fileCount,
    entryPoint: draft.entryPoint,
    entryCandidates: draft.entryCandidates,
    artifact: draft.artifact ?? null,
    validationErrors: draft.errors,
    validationWarnings: draft.warnings,
    sourceName: draft.sourceName,
    validationStatus: draft.errors?.length ? "invalid" : "valid",
    buildStatus: draft.artifact ? "success" : "idle",
    publishStatus: "idle",
  };
}

export type StudioTab = "import" | "params" | "files" | "publish";

export interface StudioShellProps {
  children: React.ReactNode;
  currentTab: StudioTab;
  draft?: CapsuleDraft;
  onTabChange?: (tab: string) => void;
  showAdvanced?: boolean;
  manifestActions?: {
    downloadManifest?: () => void;
    openManifestEditor?: () => void;
    resetManifest?: () => void;
    canDownload?: boolean;
    disableActions?: boolean;
  };
}

/**
 * Studio Shell - Main container for vibe creation workflow
 * Provides tab navigation and validation status display
 * Based on mvp-plan.md Studio section
 */
export function StudioShell({
  children,
  currentTab,
  draft,
  onTabChange,
  showAdvanced = false,
  manifestActions,
}: StudioShellProps) {
  const showAdvancedTabs = showAdvanced || currentTab === "params" || currentTab === "files";
  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Header with Status */}
      <div className="vc-glass-muted border-b p-4">
        <div className="flex items-center justify-between">
          <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">Studio</h1>
                <Badge variant="outline" className="border-dashed uppercase tracking-wide">
                  Experimental
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Create and publish runnable vibes without leaving the browser
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
        <div className="vc-glass-muted border-b">
          <TabsList className="h-14 w-full justify-start rounded-none border-0 bg-transparent p-0">
            <TabsTrigger
              value="import"
              className="relative h-14 rounded-none border-b-2 border-transparent px-6 data-[state=active]:border-primary data-[state=active]:bg-transparent"
            >
              <Upload className="mr-2 h-4 w-4" />
              Import
            </TabsTrigger>
            {showAdvancedTabs && (
              <TabsTrigger
                value="params"
                className="relative h-14 rounded-none border-b-2 border-transparent px-6 data-[state=active]:border-primary data-[state=active]:bg-transparent"
                disabled={!draft?.manifest}
              >
                <Sliders className="mr-2 h-4 w-4" />
                Params
              </TabsTrigger>
            )}
            {showAdvancedTabs && (
              <TabsTrigger
                value="files"
                className="relative h-14 rounded-none border-b-2 border-transparent px-6 data-[state=active]:border-primary data-[state=active]:bg-transparent"
                disabled={!draft?.manifest}
              >
                <FileCode className="mr-2 h-4 w-4" />
                Files
              </TabsTrigger>
            )}
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
          <ManifestErrorActions
            message="We found issues in manifest.json. Fix them below or choose an action."
            errors={draft.validationErrors}
            onDownloadManifest={manifestActions?.downloadManifest}
            onOpenEditor={manifestActions?.openManifestEditor ?? (onTabChange ? () => onTabChange("files") : undefined)}
            onResetManifest={manifestActions?.resetManifest}
            canDownload={manifestActions?.canDownload}
            disableActions={manifestActions?.disableActions}
          />
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
