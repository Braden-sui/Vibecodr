"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { AlertCircle, CheckCircle2, FileCode, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { capsulesApi } from "@/lib/api";
import { trackClientError } from "@/lib/analytics";
import { formatBytes } from "@/lib/zipBundle";
import { inferContentType } from "@/lib/contentType";
import type { CapsuleDraft, DraftFile } from "./StudioShell";
import { ManifestErrorActions } from "./ManifestErrorActions";
import { useManifestActions } from "./useManifestActions";

type FilesTabProps = {
  draft?: CapsuleDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<CapsuleDraft | undefined>>;
  buildAuthInit?: () => Promise<RequestInit | undefined>;
  isHydrating?: boolean;
};

type FileSummary = { path: string; size?: number };

type CompileInfo = {
  artifactId: string;
  runtimeVersion?: string | null;
  bundleDigest: string;
  bundleSizeBytes: number;
};

/**
 * Files Editor Tab (wired to Worker studio.ts handlers)
 * - Loads bundle metadata from GET /capsules/:id/files-summary
 * - Saves file content via PUT /capsules/:id/files/:path
 * - Triggers compile via POST /capsules/:id/compile-draft
 */
export function FilesTab({
  draft,
  onDraftChange,
  buildAuthInit: buildAuthInitProp,
  isHydrating = false,
}: FilesTabProps) {
  const capsuleId = draft?.capsuleId;
  const { getToken } = useAuth();
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [totalSize, setTotalSize] = useState<number>(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [compileInfo, setCompileInfo] = useState<CompileInfo | null>(null);
  const manifestErrors = draft?.validationErrors ?? [];
  const hasManifestErrors = draft?.validationStatus === "invalid" && manifestErrors.length > 0;

  const { downloadManifest, resetManifest, canDownload } = useManifestActions({
    draft,
    onDraftChange,
  });

  const handleResetManifest = useCallback(() => {
    resetManifest({
      onAfterReset: () => {
        setContent("");
        setSelectedPath(null);
        setCompileInfo(null);
        setError(null);
        setStatus(null);
      },
    });
  }, [resetManifest]);

  const buildAuthInit = useCallback(async (): Promise<RequestInit | undefined> => {
    if (typeof buildAuthInitProp === "function") {
      return buildAuthInitProp();
    }
    if (typeof getToken !== "function") return undefined;
    const token = await getToken({ template: "workers" });
    if (!token) return undefined;
    return { headers: { Authorization: `Bearer ${token}` } };
  }, [buildAuthInitProp, getToken]);

  const refreshSummary = useCallback(async () => {
    if (!capsuleId) return;
    setStatus("Loading files...");
    setError(null);
    try {
      const init = await buildAuthInit();
      const response = await capsulesApi.filesSummary(capsuleId, init);
      if (!response.ok) {
        const body = (await safeJson(response)) as { error?: string };
        throw new Error(body?.error || `Failed to load files for capsule ${capsuleId}`);
      }
      const summary = (await response.json()) as {
        capsuleId: string;
        manifest: CapsuleDraft["manifest"];
        files: FileSummary[];
        totalSize?: number;
      };

      setFiles(summary.files ?? []);
      setTotalSize(summary.totalSize ?? 0);

      onDraftChange((prev) => {
        const nextFiles: DraftFile[] =
          summary.files?.map((file) => ({
            path: file.path,
            size: file.size ?? 0,
            type: inferContentType(file.path),
          })) ?? [];

        const next: CapsuleDraft = {
          id: prev?.id ?? capsuleId ?? crypto.randomUUID(),
          capsuleId,
          manifest: summary.manifest ?? prev?.manifest,
          files: nextFiles.length > 0 ? nextFiles : prev?.files,
          sourceZipName: prev?.sourceZipName,
          validationStatus: "valid",
          validationErrors: undefined,
          validationWarnings: prev?.validationWarnings,
          buildStatus: prev?.buildStatus ?? "idle",
          artifact: prev?.artifact ?? null,
          publishStatus: prev?.publishStatus ?? "idle",
          postId: prev?.postId,
        };
        return next;
      });

      setSelectedPath((prev) => {
        if (prev && summary.files?.some((f) => f.path === prev)) {
          return prev;
        }
        if (summary.manifest?.entry) {
          return summary.manifest.entry;
        }
        return summary.files?.[0]?.path ?? null;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load capsule files";
      setError(message);
      trackClientError("E-VIBECODR-0903", { area: "studio.files.summary", capsuleId, message });
    } finally {
      setStatus(null);
    }
  }, [buildAuthInit, capsuleId, onDraftChange]);

  useEffect(() => {
    if (!capsuleId) return;
    void refreshSummary();
  }, [capsuleId, refreshSummary]);

  useEffect(() => {
    if (!capsuleId || !selectedPath) return;
    let cancelled = false;
    const loadFile = async () => {
      setIsLoadingFile(true);
      setStatus(`Loading ${selectedPath}...`);
      setError(null);
      try {
        const init = await buildAuthInit();
        const res = await capsulesApi.getFile(capsuleId, selectedPath, init);
        if (!res.ok) {
          const body = (await safeJson(res)) as { error?: string };
          throw new Error(body?.error || `Failed to load ${selectedPath}`);
        }
        const text = await res.text();
        if (!cancelled) {
          setContent(text);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load file";
        if (!cancelled) {
          setError(message);
          trackClientError("E-VIBECODR-0904", { area: "studio.files.load", capsuleId, path: selectedPath, message });
        }
      } finally {
        if (!cancelled) {
          setIsLoadingFile(false);
          setStatus(null);
        }
      }
    };
    void loadFile();
    return () => {
      cancelled = true;
    };
  }, [buildAuthInit, capsuleId, selectedPath]);

  const handleSave = useCallback(async () => {
    if (!capsuleId || !selectedPath) return;
    setIsSaving(true);
    setStatus("Saving file...");
    setError(null);
    setCompileInfo(null);
    try {
      const init = await buildAuthInit();
      const putRes = await capsulesApi.putFile(
        capsuleId,
        selectedPath,
        content,
        inferContentType(selectedPath),
        init
      );
      if (!putRes.ok) {
        const body = (await safeJson(putRes)) as { error?: string };
        throw new Error(body?.error || `Failed to save ${selectedPath}`);
      }
      const saveResult = (await safeJson(putRes)) as { size?: number; totalSize?: number };
      if (typeof saveResult?.totalSize === "number") {
        setTotalSize(saveResult.totalSize);
      }
      if (typeof saveResult?.size === "number") {
        setFiles((prev) =>
          prev.map((file) => (file.path === selectedPath ? { ...file, size: saveResult.size } : file))
        );
      }

      onDraftChange((prev) =>
        prev
          ? {
              ...prev,
              validationStatus: "validating",
              buildStatus: "building",
              validationErrors: undefined,
            }
          : prev
      );

      setStatus("Compiling draft artifact...");
      const compileRes = await capsulesApi.compileDraft(capsuleId, init);
      if (!compileRes.ok) {
        const body = (await safeJson(compileRes)) as { error?: string };
        throw new Error(body?.error || `Compile failed (${compileRes.status})`);
      }
      const compiled = (await compileRes.json()) as CompileInfo;
      setCompileInfo(compiled);
      onDraftChange((prev) =>
        prev
          ? {
              ...prev,
              validationStatus: "valid",
              buildStatus: "success",
              artifact: {
                id: compiled.artifactId,
                runtimeVersion: compiled.runtimeVersion ?? null,
                bundleDigest: compiled.bundleDigest,
                bundleSizeBytes: compiled.bundleSizeBytes ?? null,
                status: "ready",
              },
            }
          : prev
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save file";
      setError(message);
      onDraftChange((prev) =>
        prev
          ? {
              ...prev,
              buildStatus: "failed",
              validationStatus: "invalid",
              validationErrors: [{ path: selectedPath, message }],
            }
          : prev
      );
      trackClientError("E-VIBECODR-0905", { area: "studio.files.save", capsuleId, path: selectedPath, message });
    } finally {
      setIsSaving(false);
      setStatus(null);
    }
  }, [buildAuthInit, capsuleId, content, onDraftChange, selectedPath]);

  if (!capsuleId) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Import first</CardTitle>
            <CardDescription>Import from GitHub or ZIP to edit files.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The Files tab uses the draft capsule created by Import. Provide a capsuleId in the URL or run an import.
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedSize = files.find((f) => f.path === selectedPath)?.size ?? 0;
  const canSave = Boolean(selectedPath && !isSaving && !isLoadingFile);

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        {hasManifestErrors && (
          <ManifestErrorActions
            message="We found issues in manifest.json. Fix them below or choose an action."
            errors={manifestErrors}
            onDownloadManifest={canDownload ? downloadManifest : undefined}
            onOpenEditor={undefined}
            onResetManifest={handleResetManifest}
            disableActions={isSaving || isLoadingFile || isHydrating}
            canDownload={canDownload}
          />
        )}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Files</CardTitle>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refreshSummary()} disabled={isHydrating}>
                <RefreshCw className="h-4 w-4" />
                <span className="sr-only">Refresh</span>
              </Button>
            </div>
            <CardDescription>Select a file from your uploaded bundle.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 p-0">
            {files.length === 0 && (
              <p className="px-4 py-3 text-sm text-muted-foreground">No files found for this capsule.</p>
            )}
            {files.map((file) => (
              <button
                key={file.path}
                onClick={() => setSelectedPath(file.path)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-muted ${
                  selectedPath === file.path ? "bg-muted" : ""
                }`}
              >
                <FileCode className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-left font-mono text-xs">{file.path}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(file.size ?? 0)}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Storage</CardTitle>
            <CardDescription>Server-side bundle metadata from files-summary.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted-foreground">Bundle Size</span>
                <span className="font-medium">{formatBytes(totalSize)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full transition-all ${
                    totalSize / (25 * 1024 * 1024) > 0.9
                      ? "bg-destructive"
                      : totalSize / (25 * 1024 * 1024) > 0.7
                        ? "bg-yellow-500"
                        : "bg-primary"
                  }`}
                  style={{
                    width: `${Math.min((totalSize / (25 * 1024 * 1024)) * 100, 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Free tier budget: 25 MB.</p>
            </div>
          </CardContent>
        </Card>

        {status && (
          <div className="flex items-center gap-2 rounded-md border border-muted-foreground/30 bg-muted/40 p-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {status}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <Card className="flex-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <FileCode className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">{selectedPath ?? "Select a file"}</CardTitle>
                {selectedPath === "manifest.json" && <Badge variant="secondary">Required</Badge>}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleSave} disabled={!canSave}>
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving
                    </>
                  ) : (
                    "Save & Compile"
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="h-[520px] w-full resize-none border-0 bg-muted/50 p-4 font-mono text-sm focus:outline-none"
              spellCheck={false}
              disabled={!selectedPath || isLoadingFile}
            />
          </CardContent>
        </Card>

        {selectedPath && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">File Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Size:</span>
                <span>{formatBytes(selectedSize)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lines:</span>
                <span>{content.split("\n").length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Characters:</span>
                <span>{content.length}</span>
              </div>

              {selectedPath === "manifest.json" && (
                <>
                  <Separator className="my-2" />
                  <div className="rounded-md bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-400">
                    <p className="font-medium">Manifest File</p>
                    <p className="mt-1">
                      Edits patch back through PATCH /capsules/:id/manifest. Save to revalidate and compile.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {compileInfo && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Last Compile</CardTitle>
              <CardDescription>Draft artifact produced by compile-draft.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>Compile succeeded</span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <InfoRow label="Artifact ID" value={compileInfo.artifactId} />
                <InfoRow label="Bundle digest" value={compileInfo.bundleDigest} />
                <InfoRow label="Bundle size" value={formatBytes(compileInfo.bundleSizeBytes)} />
                <InfoRow label="Runtime version" value={compileInfo.runtimeVersion ?? "v0.1.0"} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-xs break-all">{value}</p>
    </div>
  );
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
