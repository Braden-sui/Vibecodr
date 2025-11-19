"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Github, Upload, Loader2, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { analyzeZipFile, formatBytes } from "@/lib/zipBundle";
import type { CapsuleDraft, DraftFile } from "./StudioShell";

type ImportMethod = "github" | "zip";

interface ImportTabProps {
  draft?: CapsuleDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<CapsuleDraft | undefined>>;
  onNavigateToTab?: (tab: ImportMethod | "params" | "files" | "publish") => void;
}

/**
 * Import Tab - GitHub URL and ZIP upload.
 * Replaces the simulated progress flow with real ZIP analysis and manifest validation.
 */
export function ImportTab({ draft, onDraftChange, onNavigateToTab }: ImportTabProps) {
  const [importMethod, setImportMethod] = useState<ImportMethod>("github");
  const [githubUrl, setGithubUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<
    "idle" | "downloading" | "analyzing" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string>("");
  const [isZipDragActive, setIsZipDragActive] = useState(false);

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

  const importZipFile = async (file: File) => {
    setIsImporting(true);
    setImportStatus("downloading");
    setError("");

    try {
      setImportStatus("analyzing");
      const analysis = await analyzeZipFile(file);

      if (analysis.errors && analysis.errors.length > 0) {
        setImportStatus("error");
        setError("Manifest validation failed. Review the errors below.");
        onDraftChange(() => ({
          id: crypto.randomUUID(),
          manifest: analysis.manifest,
          files: analysis.files as DraftFile[],
          sourceZipName: file.name,
          validationStatus: "invalid",
          validationWarnings: analysis.warnings,
          validationErrors: analysis.errors,
          buildStatus: "idle",
          artifact: null,
          capsuleId: undefined,
          publishStatus: "idle",
          postId: undefined,
        }));
        return;
      }

      onDraftChange(() => ({
        id: crypto.randomUUID(),
        manifest: analysis.manifest,
        files: analysis.files as DraftFile[],
        sourceZipName: file.name,
        validationStatus: "valid",
        validationWarnings: analysis.warnings,
        validationErrors: undefined,
        buildStatus: "idle",
        artifact: null,
        capsuleId: undefined,
        publishStatus: "idle",
        postId: undefined,
      }));

      setImportStatus("success");
    } catch (err) {
      console.error("ZIP upload failed:", err);
      setImportStatus("error");
      setError(err instanceof Error ? err.message : "Failed to process ZIP file");
    } finally {
      setIsImporting(false);
    }
  };

  const handleGithubImport = async () => {
    if (!githubUrl) return;

    setIsImporting(true);
    setImportStatus("downloading");
    setError("");

    try {
      // TODO: Call API endpoint POST /import/github once backend is wired.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setImportStatus("analyzing");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setImportStatus("success");
    } catch (err) {
      setImportStatus("error");
      setError(err instanceof Error ? err.message : "Import failed");
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

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold">Import a Vibe</h2>
        <p className="text-muted-foreground">
          Import from GitHub or upload a ZIP file to get started
        </p>
      </div>

      <Tabs value={importMethod} onValueChange={(v) => setImportMethod(v as ImportMethod)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="github" className="gap-2">
            <Github className="h-4 w-4" />
            GitHub
          </TabsTrigger>
          <TabsTrigger value="zip" className="gap-2">
            <Upload className="h-4 w-4" />
            ZIP Upload
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
                  <li>Include a manifest.json for best results</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
