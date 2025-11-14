"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Github, Upload, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Import Tab - GitHub URL and ZIP upload
 * Based on research-github-import-storage.md UX recommendations
 */
export function ImportTab() {
  const [importMethod, setImportMethod] = useState<"github" | "zip">("github");
  const [githubUrl, setGithubUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<
    "idle" | "downloading" | "analyzing" | "building" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string>("");

  const handleGithubImport = async () => {
    if (!githubUrl) return;

    setIsImporting(true);
    setImportStatus("downloading");
    setError("");

    try {
      // TODO: Call API endpoint POST /import/github
      // Simulate progress
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setImportStatus("analyzing");

      await new Promise((resolve) => setTimeout(resolve, 1000));
      setImportStatus("building");

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

    // TODO: Upload ZIP and process
    setIsImporting(true);
    setImportStatus("downloading");

    try {
      // Simulate upload
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setImportStatus("success");
    } catch (err) {
      setImportStatus("error");
      setError("Failed to process ZIP file");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold">Import a Vibe</h2>
        <p className="text-muted-foreground">
          Import from GitHub or upload a ZIP file to get started
        </p>
      </div>

      <Tabs value={importMethod} onValueChange={(v) => setImportMethod(v as any)}>
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
                Paste a GitHub repository URL. We'll download, analyze, and prepare your code.
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

              <Button
                onClick={handleGithubImport}
                disabled={!githubUrl || isImporting}
                className="w-full"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Github className="mr-2 h-4 w-4" />
                    Import from GitHub
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Import Progress */}
          {importStatus !== "idle" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {importStatus === "success" ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      Import Successful
                    </>
                  ) : importStatus === "error" ? (
                    <>
                      <AlertCircle className="h-5 w-5 text-destructive" />
                      Import Failed
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Importing...
                    </>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <ImportStep
                    name="Download"
                    status={
                      importStatus === "downloading"
                        ? "active"
                        : ["analyzing", "building", "success"].includes(importStatus)
                          ? "complete"
                          : "pending"
                    }
                  />
                  <ImportStep
                    name="Analyze"
                    status={
                      importStatus === "analyzing"
                        ? "active"
                        : ["building", "success"].includes(importStatus)
                          ? "complete"
                          : "pending"
                    }
                  />
                  <ImportStep
                    name="Build"
                    status={
                      importStatus === "building"
                        ? "active"
                        : importStatus === "success"
                          ? "complete"
                          : "pending"
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
              </CardContent>
            </Card>
          )}

          {/* Import Guidelines */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import Guidelines</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>• We'll detect your entry file (index.html, main.js, etc.)</p>
              <p>• Bundle size limit: 25 MB (Free/Creator), up to 250 MB (Team)</p>
              <p>• SSR or server-only code will be flagged</p>
              <p>• License information will be detected (SPDX)</p>
              <p>
                • For best results, use static exports (Next.js: next export, Vite: vite build)
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ZIP Upload */}
        <TabsContent value="zip" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Upload ZIP File</CardTitle>
              <CardDescription>
                Upload a ZIP containing your built static files
              </CardDescription>
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

              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium">ZIP Requirements:</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>Must contain an index.html or main entry file</li>
                  <li>All assets should be relative paths</li>
                  <li>No server-side code or Node.js dependencies</li>
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
        className={`text-sm ${status === "active" ? "font-medium" : status === "complete" ? "text-muted-foreground" : "text-muted-foreground"}`}
      >
        {name}
      </span>
      {status === "active" && <Badge variant="secondary">In Progress</Badge>}
    </div>
  );
}
