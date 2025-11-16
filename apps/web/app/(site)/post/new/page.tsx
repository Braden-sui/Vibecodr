"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Code2, Image as ImageIcon, Link2, Github, Upload, Loader2 } from "lucide-react";
import { postsApi, capsulesApi } from "@/lib/api";
import { redirectToSignIn } from "@/lib/client-auth";
import {
  analyzeZipFile,
  buildCapsuleFormData,
  formatBytes,
  type ZipManifestIssue,
} from "@/lib/zipBundle";

export default function ShareVibePage() {
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [imageName, setImageName] = useState<string>("");
  const [capsuleId, setCapsuleId] = useState<string | null>(null);
  const [capsuleSource, setCapsuleSource] = useState<"github" | "zip" | null>(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [importStatus, setImportStatus] = useState<"idle" | "importing" | "ready" | "error">("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sharedPostId, setSharedPostId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zipSummary, setZipSummary] = useState<{ fileName: string; totalSize: number } | null>(null);
  const [zipWarnings, setZipWarnings] = useState<ZipManifestIssue[]>([]);
  const [zipPublishWarnings, setZipPublishWarnings] = useState<string[]>([]);

  const isImporting = importStatus === "importing";

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageName(file.name);
  };

  const handleGithubImport = async () => {
    const trimmedUrl = githubUrl.trim();
    if (!trimmedUrl || isImporting) return;

    setImportError(null);
    setImportStatus("importing");

    try {
      const response = await capsulesApi.importGithub({ url: trimmedUrl });

      if (response.status === 401) {
        redirectToSignIn("/post/new");
        return;
      }

      const data = (await response.json()) as {
        success?: boolean;
        capsuleId?: string;
        manifest?: { title?: string };
        error?: string;
        errors?: string[];
      };

      if (!response.ok || !data.success || !data.capsuleId) {
        const message = data.error || "Import failed. Please check the repository URL and try again.";
        setImportError(message);
        setImportStatus("error");
        return;
      }

      setCapsuleId(data.capsuleId);
      setCapsuleSource("github");
      if (!title.trim() && data.manifest?.title) {
        setTitle(data.manifest.title);
      }
      setImportStatus("ready");
    } catch (err) {
      console.error("Failed to import from GitHub:", err);
      setImportError("Import failed. Please try again.");
      setImportStatus("error");
    }
  };

  const handleZipUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || isImporting) return;

    setImportError(null);
    setImportStatus("importing");
    setZipWarnings([]);
    setZipPublishWarnings([]);

    try {
      const analysis = await analyzeZipFile(file);

      if (analysis.errors && analysis.errors.length > 0) {
        setZipSummary({
          fileName: file.name,
          totalSize: analysis.totalSize,
        });
        setZipWarnings(analysis.errors);
        setImportStatus("error");
        setImportError("Manifest validation failed. Please fix manifest.json and try again.");
        return;
      }

      setZipSummary({
        fileName: file.name,
        totalSize: analysis.totalSize,
      });
      setZipWarnings(analysis.warnings ?? []);

      const formData = buildCapsuleFormData(analysis.manifest, analysis.files);
      const response = await capsulesApi.publish(formData);

      if (response.status === 401) {
        redirectToSignIn("/post/new");
        setImportStatus("idle");
        return;
      }

      const data = (await response.json()) as {
        success?: boolean;
        capsuleId?: string;
        warnings?: string[];
        error?: string;
      };

      if (!response.ok || !data.success || !data.capsuleId) {
        const message = data.error || "Upload failed. Please check your ZIP and try again.";
        setImportError(message);
        setImportStatus("error");
        return;
      }

      setCapsuleId(data.capsuleId);
      setCapsuleSource("zip");
      setZipPublishWarnings(data.warnings ?? []);
      if (!title.trim() && analysis.manifest.title) {
        setTitle(analysis.manifest.title);
      }
      setImportStatus("ready");
    } catch (err) {
      console.error("Failed to import ZIP:", err);
      setImportError("Upload failed. Please try again.");
      setImportStatus("error");
      setZipSummary(null);
      setZipWarnings([]);
      setZipPublishWarnings([]);
    } finally {
      // Allow re-uploading the same file if needed
      event.target.value = "";
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedTitle = title.trim();
    const trimmedCaption = caption.trim();

    if (!trimmedTitle) {
      setError("Please give your vibe a title before sharing.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const type: "app" | "report" = capsuleId ? "app" : "report";
      const response = await postsApi.create({
        title: trimmedTitle,
        description: trimmedCaption || undefined,
        type,
        capsuleId: capsuleId ?? undefined,
      });

      if (response.status === 401) {
        redirectToSignIn("/post/new");
        return;
      }

      if (!response.ok) {
        console.error("Failed to share vibe:", await response.text());
        setError("Failed to share your vibe. Please try again.");
        return;
      }

      const data = (await response.json()) as { id?: string };
      setSharedPostId(data.id ?? null);
      setSubmitted(true);
    } catch (err) {
      console.error("Failed to share vibe:", err);
      setError("Failed to share your vibe. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetZipUpload = () => {
    setCapsuleId(null);
    setCapsuleSource(null);
    setZipSummary(null);
    setZipWarnings([]);
    setZipPublishWarnings([]);
    setImportStatus("idle");
    setImportError(null);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 py-4">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3 text-amber-500" />
          Share a vibe
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Share a vibe</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Start with a runnable vibe from Studio, then add context with text, links, or an image. Everything you post
          here shows up as a vibe in the feed.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Code2 className="h-4 w-4" />
                Runnable vibe
              </CardTitle>
              <CardDescription>
                Attach one of your Studio outputs so people can run your vibe inline.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="github-url">Import a runnable vibe</Label>
                <p className="text-xs text-muted-foreground">
                  Import from GitHub or upload a ZIP. We will turn it into a runnable vibe for the player.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <Input
                      id="github-url"
                      placeholder="https://github.com/username/repo"
                      value={githubUrl}
                      onChange={(event) => setGithubUrl(event.target.value)}
                      disabled={isImporting}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={handleGithubImport}
                    disabled={!githubUrl.trim() || isImporting}
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Importing…
                      </>
                    ) : (
                      <>
                        <Github className="h-4 w-4" />
                        Import from GitHub
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="zip-upload" className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Or upload a ZIP
                </Label>
                <Input
                  id="zip-upload"
                  type="file"
                  accept=".zip"
                  onChange={handleZipUpload}
                  disabled={isImporting}
                />
                <p className="text-xs text-muted-foreground">
                  Use a ZIP of your built static files (index.html and assets).
                </p>
              </div>

              {importStatus === "ready" && capsuleId && (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                  The vibe is set — are you ready to share the vibe?
                </div>
              )}

              {zipSummary && capsuleSource === "zip" && (
                <div className="space-y-2 rounded-md border border-muted-foreground/20 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{zipSummary.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(zipSummary.totalSize)}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={resetZipUpload}>
                      Replace ZIP
                    </Button>
                  </div>
                  {zipWarnings.length > 0 && (
                    <div className="space-y-1 rounded-md bg-yellow-500/10 p-2 text-yellow-700 dark:text-yellow-400">
                      <p className="text-xs font-medium">Manifest warnings</p>
                      {zipWarnings.slice(0, 4).map((warning, index) => (
                        <p key={`${warning.path}-${index}`}>
                          <span className="font-mono">{warning.path}</span>: {warning.message}
                        </p>
                      ))}
                    </div>
                  )}
                  {zipPublishWarnings.length > 0 && (
                    <div className="space-y-1 rounded-md bg-yellow-500/10 p-2 text-yellow-700 dark:text-yellow-400">
                      <p className="text-xs font-medium">Publish warnings</p>
                      {zipPublishWarnings.map((warning, index) => (
                        <p key={`${warning}-${index}`}>{warning}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {importError && (
                <p className="text-xs text-destructive">{importError}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/studio">Open Studio</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/studio/import">Import a new vibe</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vibe details</CardTitle>
              <CardDescription>
                Optional context that appears alongside your runnable vibe in the feed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Vibe title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Give your vibe a short, descriptive title"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="caption">Vibe text</Label>
                <Textarea
                  id="caption"
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder="What should people know before they run this vibe?"
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="link" className="flex items-center gap-1">
                  <Link2 className="h-3 w-3" />
                  Optional link
                </Label>
                <Input
                  id="link"
                  type="url"
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://example.com, repo URL, or reference article"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="image" className="flex items-center gap-1">
                  <ImageIcon className="h-3 w-3" />
                  Optional image
                </Label>
                <Input id="image" type="file" accept="image/*" onChange={handleImageChange} />
                {imageName && (
                  <p className="text-xs text-muted-foreground">Selected: {imageName}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Helpful for non-code vibes or giving a quick visual of what your vibe does.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>
                This is a rough preview of how your vibe might appear in the feed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Runnable vibe</div>
                <div className="h-32 rounded-md border border-dashed border-muted-foreground/40 bg-background" />
              </div>
              {caption && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Vibe text</div>
                  <p className="rounded-md border bg-background p-2 text-sm">{caption}</p>
                </div>
              )}
              {linkUrl && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Link</div>
                  <p className="truncate text-xs text-blue-600 underline underline-offset-2">{linkUrl}</p>
                </div>
              )}
              {imageName && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Image</div>
                  <p className="text-xs text-muted-foreground">{imageName}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-4">
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting || !title.trim()}
              >
                {isSubmitting ? "Sharing…" : "Share vibe"}
              </Button>
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
              {submitted && !error && (
                <p className="text-xs text-muted-foreground">
                  Your vibe has been shared. New posts will start to appear in the feed once the viewer is fully wired
                  up. {sharedPostId && (
                    <>
                      {" "}
                      <Link href={`/player/${sharedPostId}`} className="underline">
                        View it in the player.
                      </Link>
                    </>
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
