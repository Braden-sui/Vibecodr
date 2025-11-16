"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Github, Upload, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import JSZip from "jszip";
import { validateManifest, type Manifest } from "@vibecodr/shared/manifest";
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

  const totalSize = useMemo(() => {
    if (!draft?.files || draft.files.length === 0) return 0;
    return draft.files.reduce((sum, file) => sum + file.size, 0);
  }, [draft?.files]);

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

    setIsImporting(true);
    setImportStatus("downloading");
    setError("");

    try {
      const zip = await JSZip.loadAsync(file);
      setImportStatus("analyzing");

      const entries = Object.values(zip.files).filter(
        (entry) => !entry.dir && !entry.name.startsWith("__MACOSX/")
      );

      if (entries.length === 0) {
        throw new Error("ZIP archive is empty.");
      }

      const rootPrefix = detectCommonRoot(entries.map((entry) => entry.name));
      const extractedFiles: DraftFile[] = [];
      let manifestData: Manifest | undefined;
      let manifestText: string | undefined;

      for (const entry of entries) {
        const cleanPath = normalizePath(entry.name, rootPrefix);
        if (!cleanPath) continue;

        if (cleanPath.toLowerCase() === "manifest.json" && !manifestData) {
          manifestText = await entry.async("text");
          try {
            manifestData = JSON.parse(manifestText);
          } catch (err) {
            throw new Error("manifest.json is not valid JSON.");
          }

          const manifestFile = new File([manifestText], "manifest.json", {
            type: "application/json",
          });

          extractedFiles.push({
            path: "manifest.json",
            type: "application/json",
            size: manifestText.length,
            file: manifestFile,
          });
          continue;
        }

        const arrayBuffer = await entry.async("arraybuffer");
        const contentType = guessContentType(cleanPath);
        const blobFile = new File([arrayBuffer], cleanPath.split("/").pop() ?? cleanPath, {
          type: contentType,
        });

        extractedFiles.push({
          path: cleanPath,
          type: contentType,
          size: arrayBuffer.byteLength,
          file: blobFile,
        });
      }

      if (!manifestData) {
        throw new Error("manifest.json is required in the ZIP file.");
      }

      const validation = validateManifest(manifestData);
      const mappedWarnings =
        validation.warnings?.map((warning) => ({
          path: warning.path,
          message: warning.message,
        })) ?? [];
      const mappedErrors =
        !validation.valid && validation.errors
          ? validation.errors.map((err) => ({
              path: err.path,
              message: err.message,
            }))
          : undefined;

      onDraftChange(() => ({
        id: crypto.randomUUID(),
        manifest: manifestData,
        files: extractedFiles,
        sourceZipName: file.name,
        validationStatus: validation.valid ? "valid" : "invalid",
        validationWarnings: mappedWarnings,
        validationErrors: mappedErrors,
        buildStatus: "idle",
        artifact: null,
        capsuleId: undefined,
        publishStatus: "idle",
        postId: undefined,
      }));

      if (!validation.valid) {
        setImportStatus("error");
        setError("Manifest validation failed. Review the errors below.");
        return;
      }

      setImportStatus("success");
    } catch (err) {
      console.error("ZIP upload failed:", err);
      setImportStatus("error");
      setError(err instanceof Error ? err.message : "Failed to process ZIP file");
    } finally {
      setIsImporting(false);
      e.target.value = "";
    }
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
                  <ImportStep
                    name="Download"
                    status={
                      importStatus === "downloading"
                        ? "active"
                        : importStatus === "idle"
                          ? "pending"
                          : "complete"
                    }
                  />
                  <ImportStep
                    name="Analyze"
                    status={
                      importStatus === "analyzing"
                        ? "active"
                        : importStatus === "idle"
                          ? "pending"
                          : importStatus === "downloading"
                            ? "pending"
                            : "complete"
                    }
                  />
                  <ImportStep
                    name="Ready"
                    status={importStatus === "success" ? "complete" : "pending"}
                  />

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
              <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
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
                  <ImportStep
                    name="Download"
                    status={
                      importStatus === "downloading"
                        ? "active"
                        : importStatus === "idle"
                          ? "pending"
                          : "complete"
                    }
                  />
                  <ImportStep
                    name="Analyze"
                    status={
                      importStatus === "analyzing"
                        ? "active"
                        : importStatus === "downloading"
                          ? "pending"
                          : importStatus === "idle"
                            ? "pending"
                            : "complete"
                    }
                  />
                  <ImportStep
                    name="Ready"
                    status={importStatus === "success" ? "complete" : "pending"}
                  />

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

function detectCommonRoot(paths: string[]): string | undefined {
  const candidates = paths
    .map((path) => {
      const idx = path.indexOf("/");
      return idx === -1 ? null : path.slice(0, idx + 1);
    })
    .filter((value): value is string => Boolean(value));

  if (candidates.length === 0) return undefined;
  const first = candidates[0];
  return candidates.every((candidate) => candidate === first) ? first : undefined;
}

function normalizePath(path: string, prefix?: string): string | null {
  let clean = path;
  if (prefix && clean.startsWith(prefix)) {
    clean = clean.slice(prefix.length);
  }
  clean = clean.replace(/^\.\/+/, "");
  if (!clean) return null;
  return clean;
}

function guessContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const lookup: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    js: "application/javascript",
    mjs: "application/javascript",
    css: "text/css",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    ico: "image/x-icon",
    txt: "text/plain",
  };
  return lookup[ext] ?? "application/octet-stream";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
