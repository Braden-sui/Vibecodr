"use client";

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Github, Upload, Loader2, CheckCircle2, FileCode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/zipBundle";
import { capsulesApi } from "@/lib/api";
import { redirectToSignIn } from "@/lib/client-auth";
import { trackEvent } from "@/lib/analytics";
import type { Manifest } from "@vibecodr/shared/manifest";
import type { CapsuleDraft, DraftArtifact, DraftFile } from "./StudioShell";

type ImportMethod = "github" | "zip" | "single";

interface ImportTabProps {
  draft?: CapsuleDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<CapsuleDraft | undefined>>;
  onNavigateToTab?: (tab: ImportMethod | "params" | "files" | "publish") => void;
  buildAuthInit?: () => Promise<RequestInit | undefined>;
}

/**
 * Import Tab - GitHub URL and ZIP upload.
 * Replaces the simulated progress flow with real ZIP analysis and manifest validation.
 */
export function ImportTab({ draft, onDraftChange, onNavigateToTab, buildAuthInit: buildAuthInitProp }: ImportTabProps) {
  const [importMethod, setImportMethod] = useState<ImportMethod>("github");
  const [githubUrl, setGithubUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<
    "idle" | "downloading" | "analyzing" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string>("");
  const [isZipDragActive, setIsZipDragActive] = useState(false);
  const { getToken } = useAuth();
  const [singleStatus, setSingleStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [singleError, setSingleError] = useState<string>("");

  const buildAuthInit = useCallback(async (): Promise<RequestInit | undefined> => {
    if (typeof buildAuthInitProp === "function") {
      return buildAuthInitProp();
    }
    if (typeof getToken !== "function") return undefined;
    const token = await getToken({ template: "workers" });
    if (!token) return undefined;
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  }, [buildAuthInitProp, getToken]);

  const applyServerManifest = useCallback(
    (
      manifest: Manifest,
      warnings?: Array<{ path: string; message: string }>,
      errors?: Array<{ path: string; message: string }>,
      options?: {
        sourceName?: string;
        capsuleId?: string;
        artifact?: DraftArtifact | null;
        files?: DraftFile[];
      }
    ) => {
      const hasErrors = Boolean(errors?.length);
      const validationStatus: CapsuleDraft["validationStatus"] = hasErrors ? "invalid" : "valid";
      const buildStatus: CapsuleDraft["buildStatus"] = hasErrors ? "failed" : "success";
      onDraftChange(() => ({
        id: crypto.randomUUID(),
        manifest,
        files: options?.files,
        sourceZipName: options?.sourceName,
        validationStatus,
        validationWarnings: warnings,
        validationErrors: errors,
        buildStatus,
        artifact: options?.artifact ?? null,
        capsuleId: options?.capsuleId,
        publishStatus: "idle",
        postId: undefined,
      }));
      return validationStatus;
    },
    [onDraftChange]
  );

  const totalSize = useMemo(() => {
    if (!draft?.files || draft.files.length === 0) return 0;
    return draft.files.reduce((sum, file) => sum + file.size, 0);
  }, [draft?.files]);

  const downloadStepStatus =
    importStatus === "idle"
      ? "pending"
      : importStatus === "downloading"
        ? "active"
        : "complete";

  const analyzeStepStatus =
    importStatus === "analyzing"
      ? "active"
      : importStatus === "downloading"
        ? "pending"
        : importStatus === "idle"
          ? "pending"
          : "complete";

  const readyStepStatus = importStatus === "success" ? "complete" : "pending";

  // WHY: Option B — Server handles all ZIP analysis, manifest generation, and validation.
  // Client sends raw ZIP directly to /import/zip, server returns capsuleId + manifest + warnings/errors.
  // This removes JSZip dependency from Studio import flow and eliminates duplicate validation logic.
  const importZipFile = async (file: File) => {
    setIsImporting(true);
    setImportStatus("downloading");
    setError("");

    try {
      setImportStatus("analyzing");
      const init = await buildAuthInit();
      // INVARIANT: capsulesApi.importZip sends raw ZIP to worker /import/zip
      // Server analyzes, generates/validates manifest, enforces safety, writes to R2/DB
      const response = await capsulesApi.importZip(file, init);

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      const data = (await response.json()) as {
        success?: boolean;
        capsuleId?: string;
        manifest?: Manifest;
        filesSummary?: { totalSize?: number; fileCount?: number; entryPoint?: string };
        warnings?: Array<{ path: string; message: string }>;
        errors?: Array<{ path: string; message: string }>;
        artifact?: DraftArtifact | null;
        error?: string;
      };

      // Handle validation errors from server
      if (data.errors && data.errors.length > 0) {
        setImportStatus("error");
        setError("Manifest validation failed. Review the errors below.");
        onDraftChange(() => ({
          id: crypto.randomUUID(),
          manifest: data.manifest ?? { version: "1.0", runner: "client-static", entry: "index.html" },
          files: undefined, // Files stored server-side; Files tab can fetch on-demand
          sourceZipName: file.name,
          validationStatus: "invalid",
          validationWarnings: data.warnings,
          validationErrors: data.errors,
          buildStatus: "failed",
          artifact: null,
          capsuleId: data.capsuleId,
          publishStatus: "idle",
          postId: undefined,
        }));
        trackEvent("studio_import_zip_failed", { error: "server-validation" });
        return;
      }

      if (!response.ok || !data.success || !data.manifest) {
        const message = data.error || "ZIP import failed. Please check your archive.";
        setImportStatus("error");
        setError(message);
        trackEvent("studio_import_zip_failed", { error: message });
        return;
      }

      // Success: use server manifest and capsuleId, files stored server-side
      const validationStatus = applyServerManifest(data.manifest, data.warnings, data.errors, {
        sourceName: file.name,
        capsuleId: data.capsuleId,
        artifact: data.artifact ?? null,
        files: undefined, // Files stored server-side; Files tab can fetch via capsulesApi.getFile()
      });
      if (validationStatus === "invalid") {
        setImportStatus("error");
        setError("Manifest validation failed. Review the errors below.");
      } else {
        setImportStatus("success");
        trackEvent("studio_import_zip_success", { capsuleId: data.capsuleId });
      }
    } catch (err) {
      console.error("ZIP upload failed:", err);
      const message = err instanceof Error ? err.message : "Failed to process ZIP file";
      setImportStatus("error");
      setError(message);
      trackEvent("studio_import_zip_failed", { error: message });
    } finally {
      setIsImporting(false);
    }
  };

  const importSingleFile = async (file: File) => {
    setSingleStatus("uploading");
    setSingleError("");
    setError("");
    try {
      const manifest: Manifest = {
        version: "1.0",
        runner: "client-static",
        entry: "index.jsx",
      };

      const formData = new FormData();
      formData.append("manifest", new Blob([JSON.stringify(manifest)], { type: "application/json" }), "manifest.json");
      formData.append("index.jsx", file, "index.jsx");

      const init = await buildAuthInit();
      const response = await capsulesApi.publish(formData, init);
      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      const data = (await response.json()) as {
        success?: boolean;
        capsuleId?: string;
        manifest?: Manifest;
        warnings?: Array<{ path: string; message: string }>;
        errors?: Array<{ path: string; message: string }>;
        artifact?: DraftArtifact | null;
        error?: string;
      };

      if (!response.ok || !data.success || !data.capsuleId) {
        const message = data.error || "Single file upload failed. Please try again.";
        setSingleStatus("error");
        setSingleError(message);
        setError(message);
        return;
      }

      const files: DraftFile[] = [
        {
          path: "index.jsx",
          type: file.type || "application/javascript",
          size: file.size,
          file,
        },
      ];

      const validationStatus = applyServerManifest(data.manifest ?? manifest, data.warnings, data.errors, {
        sourceName: file.name,
        capsuleId: data.capsuleId,
        artifact: data.artifact ?? null,
        files,
      });
      if (validationStatus === "invalid") {
        setSingleStatus("error");
        setSingleError("Manifest validation failed. Review the errors below.");
        setError("Manifest validation failed. Review the errors below.");
      } else {
        setSingleStatus("success");
        setImportMethod("single");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload file";
      setSingleStatus("error");
      setSingleError(message);
      setError(message);
    }
  };

  const handleGithubImport = async () => {
    const trimmedUrl = githubUrl.trim();
    if (!trimmedUrl) return;

    setIsImporting(true);
    setImportStatus("downloading");
    setError("");

    try {
      setImportStatus("analyzing");
      const init = await buildAuthInit();
      const response = await capsulesApi.importGithub(
        { url: trimmedUrl, branch: branch.trim() || undefined },
        init
      );

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      const data = (await response.json()) as {
        success?: boolean;
        capsuleId?: string;
        manifest?: Manifest;
        warnings?: Array<{ path: string; message: string }>;
        errors?: Array<{ path: string; message: string }>;
        artifact?: DraftArtifact | null;
        error?: string;
      };

      if (!response.ok || !data.success || !data.manifest) {
        const message = data.error || "Import failed. Check the repository and try again.";
        setImportStatus("error");
        setError(message);
        trackEvent("studio_import_github_failed", { error: message });
        return;
      }

      const validationStatus = applyServerManifest(data.manifest, data.warnings, data.errors, {
        capsuleId: data.capsuleId,
        artifact: data.artifact ?? null,
      });
      if (validationStatus === "invalid") {
        setImportStatus("error");
        setError("Manifest validation failed. Review the errors below.");
      } else {
        setImportStatus("success");
        trackEvent("studio_import_github_success", { capsuleId: data.capsuleId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      setImportStatus("error");
      setError(message);
      trackEvent("studio_import_github_failed", { error: message });
    } finally {
      setIsImporting(false);
    }
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await importZipFile(file);
    e.target.value = "";
  };

  const handleZipDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsZipDragActive(false);

    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    await importZipFile(file);
  };

  const handleZipDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isZipDragActive) {
      setIsZipDragActive(true);
    }
  };

  const handleZipDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsZipDragActive(false);
  };

  const handleContinueToPublish = () => {
    onNavigateToTab?.("publish");
  };

  const manifestWarnings = draft?.validationWarnings ?? [];
  const manifestErrors = draft?.validationErrors ?? [];
  const hasValidationIssues = manifestWarnings.length > 0 || (manifestErrors?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold">Import a Vibe</h2>
        <p className="text-muted-foreground">
          Import from GitHub or upload a ZIP file to get started
        </p>
      </div>

      <Tabs value={importMethod} onValueChange={(v) => setImportMethod(v as ImportMethod)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="github" className="gap-2">
            <Github className="h-4 w-4" />
            GitHub
          </TabsTrigger>
          <TabsTrigger value="zip" className="gap-2">
            <Upload className="h-4 w-4" />
            ZIP Upload
          </TabsTrigger>
          <TabsTrigger value="single" className="gap-2">
            <FileCode className="h-4 w-4" />
            Single JSX
          </TabsTrigger>
        </TabsList>

        {/* GitHub Import */}
        <TabsContent value="github" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Import from GitHub</CardTitle>
              <CardDescription>
                Paste a GitHub repository URL. We&apos;ll download, analyze, and prepare your code.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="github-url">Repository URL</Label>
                <Input
                  id="github-url"
                  placeholder="https://github.com/username/repo"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  disabled={isImporting}
                />
                <p className="text-xs text-muted-foreground">
                  Supports public repos and private repos you have access to
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="branch">Branch or Tag (optional)</Label>
                <Input
                  id="branch"
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  disabled={isImporting}
                />
              </div>

              <div className="space-y-3">
                <Button onClick={handleGithubImport} disabled={!githubUrl || isImporting}>
                  {isImporting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    "Start Import"
                  )}
                </Button>

                <div className="space-y-3">
                  <ImportStep name="Download" status={downloadStepStatus} />
                  <ImportStep name="Analyze" status={analyzeStepStatus} />
                  <ImportStep name="Ready" status={readyStepStatus} />

                  {error && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  {importStatus === "success" && (
                    <div className="rounded-md bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400">
                      Capsule imported successfully! Continue to the Params tab to configure
                      parameters.
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import Guidelines</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>- We&apos;ll detect your entry file (index.html, main.js, etc.)</p>
              <p>- Bundle size limit: 25 MB (Free/Creator), up to 250 MB (Team)</p>
              <p>- SSR or server-only code will be flagged</p>
              <p>- License information will be detected (SPDX)</p>
              <p>- For best results, use static exports (Next.js: next export, Vite: vite build)</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Single file upload */}
        <TabsContent value="single" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Upload a single React JSX file</CardTitle>
              <CardDescription>
                Provide one `.jsx` entry file. We will wrap it as `index.jsx` and publish directly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="single-file">Select file</Label>
                <Input
                  id="single-file"
                  type="file"
                  accept=".jsx,.tsx,.js,.ts"
                  disabled={singleStatus === "uploading"}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      importSingleFile(file);
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  We set runner=client-static and entry=index.jsx for you. Bundle size limits still apply.
                </p>
              </div>

              {singleStatus === "uploading" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading and publishing...
                </div>
              )}

              {singleStatus === "success" && (
                <div className="rounded-md bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400">
                  File uploaded and published. Continue to Params or Publish.
                </div>
              )}

              {singleStatus === "error" && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {singleError || "Upload failed"}
                </div>
              )}

              {error && importMethod === "single" && singleStatus !== "error" && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ZIP Upload */}
        <TabsContent value="zip" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Upload ZIP File</CardTitle>
              <CardDescription>Upload a ZIP containing your built static files</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center ${
                  isZipDragActive ? "border-primary bg-primary/5" : "border-muted"
                }`}
                onDragOver={handleZipDragOver}
                onDragLeave={handleZipDragLeave}
                onDrop={handleZipDrop}
              >
                <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
                <Label htmlFor="zip-upload" className="cursor-pointer">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Click to upload or drag and drop</p>
                    <p className="text-xs text-muted-foreground">ZIP files up to 250 MB</p>
                  </div>
                  <Input
                    id="zip-upload"
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={handleZipUpload}
                    disabled={isImporting}
                  />
                </Label>
                {isImporting && (
                  <div className="mt-4">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
              </div>

              {importStatus !== "idle" && (
                <div className="space-y-3">
                  <ImportStep name="Download" status={downloadStepStatus} />
                  <ImportStep name="Analyze" status={analyzeStepStatus} />
                  <ImportStep name="Ready" status={readyStepStatus} />

                  {error && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  {importStatus === "success" && (
                    <div className="flex flex-col gap-3 rounded-md bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400">
                      <span>Bundle processed successfully.</span>
                      <Button size="sm" variant="secondary" onClick={handleContinueToPublish}>
                        Continue to Publish
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {draft?.sourceZipName && (
                <div className="rounded-md border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{draft.sourceZipName}</p>
                      <p className="text-xs text-muted-foreground">
                        {draft.files?.length ?? 0} files - {formatBytes(totalSize)}
                      </p>
                    </div>
                    <Badge variant={draft.validationStatus === "valid" ? "default" : "destructive"}>
                      {draft.validationStatus === "valid" ? "Validated" : "Needs fixes"}
                    </Badge>
                  </div>
                  {manifestWarnings.length > 0 && (
                    <div className="mt-3 space-y-1 text-xs text-yellow-700 dark:text-yellow-400">
                      {manifestWarnings.slice(0, 3).map((warning, index) => (
                        <p key={`${warning.path}-${index}`}>
                          <span className="font-mono">{warning.path}</span>: {warning.message}
                        </p>
                      ))}
                    </div>
                  )}
                  {manifestErrors && manifestErrors.length > 0 && (
                    <div className="mt-3 space-y-1 text-xs text-destructive">
                      {manifestErrors.slice(0, 3).map((warning, index) => (
                        <p key={`${warning.path}-${index}`}>
                          <span className="font-mono">{warning.path}</span>: {warning.message}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium">ZIP Requirements:</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>Must contain an index.html or main entry file</li>
                  <li>All assets should use relative paths</li>
                  <li>No server-side code or Node.js runtime files</li>
                  <li>manifest.json is optional — we generate one if missing</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {hasValidationIssues && (
        <div className="max-w-4xl">
          <ValidationIssues warnings={manifestWarnings} errors={manifestErrors ?? []} />
        </div>
      )}
    </div>
  );
}

function ImportStep({
  name,
  status,
}: {
  name: string;
  status: "pending" | "active" | "complete";
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full ${
          status === "complete"
            ? "bg-green-600 text-white"
            : status === "active"
              ? "border-2 border-primary bg-primary/10"
              : "border-2 border-muted bg-muted"
        }`}
      >
        {status === "complete" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : status === "active" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <div className="h-2 w-2 rounded-full bg-muted-foreground" />
        )}
      </div>
      <span
        className={`text-sm ${status === "active" ? "font-medium" : "text-muted-foreground"}`}
      >
        {name}
      </span>
      {status === "active" && <Badge variant="secondary">In Progress</Badge>}
    </div>
  );
}

function ValidationIssues({
  warnings,
  errors,
}: {
  warnings: Array<{ path: string; message: string }>;
  errors: Array<{ path: string; message: string }>;
}) {
  return (
    <div className="space-y-3 rounded-md border border-dashed border-muted-foreground/30 p-4">
      <div className="space-y-1 text-sm text-muted-foreground">
        <p className="font-medium">Validation results</p>
        <p>Matches the Composer flow so creators see consistent warnings and errors.</p>
      </div>
      {errors.length > 0 && (
        <div className="space-y-2 rounded-md bg-destructive/10 p-3 text-destructive">
          <p className="text-sm font-semibold">Errors</p>
          <ul className="space-y-1 text-xs">
            {errors.map((issue, idx) => (
              <li key={`${issue.path}-${idx}`}>
                <span className="font-mono">{issue.path}</span>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="space-y-2 rounded-md bg-yellow-500/10 p-3 text-yellow-700 dark:text-yellow-400">
          <p className="text-sm font-semibold">Warnings</p>
          <ul className="space-y-1 text-xs">
            {warnings.map((issue, idx) => (
              <li key={`${issue.path}-${idx}`}>
                <span className="font-mono">{issue.path}</span>: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
