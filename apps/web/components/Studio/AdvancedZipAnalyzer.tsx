"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileCode,
  Upload,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Sparkles,
  FolderTree,
  FileJson,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { analyzeZipFile, formatBytes, type ZipAnalysisResult } from "@/lib/zipBundle";
import { usePlanGate } from "@/lib/usePlanGate";
import { Plan } from "@vibecodr/shared";
import { trackEvent, trackClientError } from "@/lib/analytics";

/**
 * Advanced ZIP Analyzer - Premium Studio Power Tool
 *
 * WHY: Per 3.2.2 — Server is the single source of truth for validation,
 * but premium users (Creator/Pro/Team) get advanced client-side analysis
 * for immediate previews before server upload.
 *
 * This tool does NOT replace server validation. It provides:
 * - Instant file tree preview
 * - Local manifest inspection
 * - Pre-flight warnings before upload
 * - Entry point detection preview
 *
 * INVARIANT: Main upload flow uses server-side processing via capsulesApi.importZip().
 * This is a supplementary power tool for advanced users.
 */
export function AdvancedZipAnalyzer() {
  const { isPremium, plan, isLoading: isPlanLoading } = usePlanGate();
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<ZipAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.endsWith(".zip")) {
      setError("Please select a ZIP file");
      trackClientError("E-VIBECODR-0909", {
        area: "studio.advancedZipAnalyzer",
        fileName: selectedFile.name,
      });
      return;
    }

    setFile(selectedFile);
    setError(null);
    setResult(null);
    setIsAnalyzing(true);

    try {
      trackEvent("studio_advanced_zip_analyze_start", { fileSize: selectedFile.size });
      const analysisResult = await analyzeZipFile(selectedFile);
      setResult(analysisResult);
      trackEvent("studio_advanced_zip_analyze_success", {
        fileCount: analysisResult.files.length,
        totalSize: analysisResult.totalSize,
        hasWarnings: (analysisResult.warnings?.length ?? 0) > 0,
        hasErrors: (analysisResult.errors?.length ?? 0) > 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to analyze ZIP file";
      setError(message);
      trackClientError("E-VIBECODR-0908", {
        area: "studio.advancedZipAnalyzer",
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        message,
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        handleFileSelect(selectedFile);
      }
    },
    [handleFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files?.[0];
      if (droppedFile) {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
  }, []);

  // Show loading state while checking plan
  if (isPlanLoading) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Show upgrade prompt for non-premium users
  if (!isPremium) {
    return (
      <Card className="border-dashed border-muted-foreground/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Advanced ZIP Analyzer</CardTitle>
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" />
              Creator+
            </Badge>
          </div>
          <CardDescription>
            Get instant client-side ZIP analysis with file tree preview, manifest inspection,
            and pre-flight warnings before server upload.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-dashed p-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Zap className="h-6 w-6 text-muted-foreground" />
            </div>
            <h4 className="font-medium">Upgrade to unlock</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              This power tool is available on Creator, Pro, and Team plans.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Current plan: <span className="font-medium capitalize">{plan}</span>
            </p>
            <Link to="/pricing">
              <Button className="mt-4 gap-2" size="sm">
                <Sparkles className="h-4 w-4" />
                Upgrade to Creator
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Premium user view
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderTree className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Advanced ZIP Analyzer</CardTitle>
            <Badge variant="outline" className="gap-1 text-xs">
              <Sparkles className="h-3 w-3" />
              Power Tool
            </Badge>
          </div>
          {file && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Clear
            </Button>
          )}
        </div>
        <CardDescription>
          Instant client-side analysis for advanced previews. Server validates on upload.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!result && !isAnalyzing && (
          <div
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
            <Label htmlFor="advanced-zip-upload" className="cursor-pointer">
              <p className="font-medium">Drop ZIP or click to analyze</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Preview files and manifest before upload
              </p>
              <Input
                id="advanced-zip-upload"
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleInputChange}
              />
            </Label>
          </div>
        )}

        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Analyzing ZIP contents...</p>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">{file?.name}</p>
                <p className="text-sm text-muted-foreground">
                  {result.files.length} files • {formatBytes(result.totalSize)}
                </p>
              </div>
              <Badge
                variant={result.errors?.length ? "destructive" : "default"}
                className={result.errors?.length ? "" : "bg-green-600"}
              >
                {result.errors?.length
                  ? `${result.errors.length} Errors`
                  : "Valid"}
              </Badge>
            </div>

            {/* Manifest Preview */}
            {result.manifest && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileJson className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Manifest</span>
                </div>
                <div className="rounded-md bg-muted p-3 font-mono text-xs">
                  <div>
                    <span className="text-muted-foreground">version:</span>{" "}
                    {result.manifest.version}
                  </div>
                  <div>
                    <span className="text-muted-foreground">runner:</span>{" "}
                    {result.manifest.runner}
                  </div>
                  <div>
                    <span className="text-muted-foreground">entry:</span>{" "}
                    {result.manifest.entry}
                  </div>
                  {result.manifest.title && (
                    <div>
                      <span className="text-muted-foreground">title:</span>{" "}
                      {result.manifest.title}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Warnings */}
            {result.warnings && result.warnings.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {result.warnings.length} Warning{result.warnings.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-1 rounded-md bg-yellow-500/10 p-3">
                  {result.warnings.map((warning, idx) => (
                    <div key={idx} className="text-xs text-yellow-700 dark:text-yellow-400">
                      <span className="font-mono">{warning.path}</span>: {warning.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Errors */}
            {result.errors && result.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {result.errors.length} Error{result.errors.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-1 rounded-md bg-destructive/10 p-3">
                  {result.errors.map((err, idx) => (
                    <div key={idx} className="text-xs text-destructive">
                      <span className="font-mono">{err.path}</span>: {err.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File List */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Files ({result.files.length})</span>
              </div>
              <ScrollArea className="h-48 rounded-md border">
                <div className="p-3 space-y-1">
                  {result.files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-1 text-xs"
                    >
                      <span className="font-mono text-muted-foreground truncate max-w-[70%]">
                        {file.path}
                      </span>
                      <span className="text-muted-foreground">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Success indicator */}
            {!result.errors?.length && (
              <div className="flex items-center gap-2 rounded-md bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  Analysis complete. Use the main import to upload — server will validate.
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
