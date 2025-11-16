"use client";

import { useState, useRef, FormEvent, ChangeEvent } from "react";
import { useUser } from "@clerk/nextjs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  Send,
  Image as ImageIcon,
  Github,
  Upload,
  Code,
  X,
  AlertCircle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { redirectToSignIn } from "@/lib/client-auth";
import { toast } from "@/lib/toast";
import { postsApi, capsulesApi, coversApi, type FeedPost } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";

type ComposerMode = "status" | "image" | "github" | "zip" | "code";

type ImportStatus = "idle" | "importing" | "ready" | "error";

export interface VibesComposerProps {
  onPostCreated?: (post: FeedPost) => void;
  className?: string;
}

/**
 * VibesComposer - Unified composer for all vibe creation modes
 * Handles text/status posts, image attachments, GitHub imports, ZIP uploads, and inline code
 */
export function VibesComposer({ onPostCreated, className }: VibesComposerProps) {
  const { user, isSignedIn } = useUser();
  const [mode, setMode] = useState<ComposerMode>("status");
  const [isExpanded, setIsExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GitHub import state
  const [githubUrl, setGithubUrl] = useState("");
  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [capsuleId, setCapsuleId] = useState<string | null>(null);

  // Image state
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);

  // ZIP state
  const [zipFile, setZipFile] = useState<File | null>(null);

  // Inline code state
  const [code, setCode] = useState("");

  // Inline capabilities & params (Advanced section)
  const [netHosts, setNetHosts] = useState("");
  const [allowStorage, setAllowStorage] = useState(false);
  const [allowWorkers, setAllowWorkers] = useState(false);
  const [enableParam, setEnableParam] = useState(false);
  const [paramLabel, setParamLabel] = useState("Intensity");
  const [paramDefault, setParamDefault] = useState(50);
  const [paramMin, setParamMin] = useState(0);
  const [paramMax, setParamMax] = useState(100);
  const [paramStep, setParamStep] = useState(1);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const isImporting = importStatus === "importing";
  const hasImportedCapsule = importStatus === "ready" && !!capsuleId;

  // Auto-detect GitHub URLs in text input
  const handleTextChange = (value: string) => {
    setTitle(value);
    
    // Auto-detect GitHub URL
    const githubPattern = /https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+/i;
    if (githubPattern.test(value) && mode === "status") {
      setMode("github");
      setGithubUrl(value);
      trackEvent("composer_mode_detected", { mode: "github" });
    }
  };

  const handleModeChange = (newMode: ComposerMode) => {
    setMode(newMode);
    setError(null);
    setImportError(null);
    trackEvent("composer_mode_changed", { mode: newMode });
  };

  const handleImageSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file");
      return;
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB");
      return;
    }

    if (!capsuleId) {
      setError("Import an app first (via GitHub or ZIP) before adding a cover image.");
      return;
    }

    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    try {
      setIsUploadingCover(true);
      const response = await coversApi.upload(file);

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      const data = (await response.json()) as { ok?: boolean; key?: string; error?: string };

      if (!response.ok || !data.ok || !data.key) {
        const message = data.error || "Failed to upload image. Please try again.";
        console.error("Cover upload failed:", message);
        setError(message);
        setImagePreview(null);
        setCoverKey(null);
        return;
      }

      setCoverKey(data.key);
    } catch (err) {
      console.error("Cover upload error:", err);
      setError("Failed to upload image. Please try again.");
      setImagePreview(null);
      setCoverKey(null);
    } finally {
      setIsUploadingCover(false);
    }
  };

  const handleZipSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".zip")) {
      setError("Please select a ZIP file");
      return;
    }

    setZipFile(file);
    setError(null);
  };

  const handleGithubImport = async () => {
    const trimmedUrl = githubUrl.trim();
    if (!trimmedUrl || isImporting) return;

    setImportError(null);
    setImportStatus("importing");

    try {
      const response = await capsulesApi.importGithub({ url: trimmedUrl });

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      const data = (await response.json()) as {
        success?: boolean;
        capsuleId?: string;
        manifest?: { title?: string };
        error?: string;
      };

      if (!response.ok || !data.success || !data.capsuleId) {
        const message = data.error || "Import failed. Please check the repository URL and try again.";
        setImportError(message);
        setImportStatus("error");
        trackEvent("composer_github_import_failed", { error: message });
        return;
      }

      setCapsuleId(data.capsuleId);
      if (!title.trim() && data.manifest?.title) {
        setTitle(data.manifest.title);
      }
      setImportStatus("ready");
      trackEvent("composer_github_import_success", { capsuleId: data.capsuleId });
    } catch (err) {
      console.error("Failed to import from GitHub:", err);
      setImportError("Import failed. Please try again.");
      setImportStatus("error");
      trackEvent("composer_github_import_error");
    }
  };

  const handleZipImport = async () => {
    if (!zipFile || isImporting) return;

    setImportError(null);
    setImportStatus("importing");

    try {
      const response = await capsulesApi.importZip(zipFile);

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      const data = (await response.json()) as {
        success?: boolean;
        capsuleId?: string;
        manifest?: { title?: string };
        error?: string;
      };

      if (!response.ok || !data.success || !data.capsuleId) {
        const message = data.error || "Upload failed. Please check your ZIP and try again.";
        setImportError(message);
        setImportStatus("error");
        trackEvent("composer_zip_import_failed", { error: message });
        return;
      }

      setCapsuleId(data.capsuleId);
      if (!title.trim() && data.manifest?.title) {
        setTitle(data.manifest.title);
      }
      setImportStatus("ready");
      trackEvent("composer_zip_import_success", { capsuleId: data.capsuleId });
    } catch (err) {
      console.error("Failed to import ZIP:", err);
      setImportError("Upload failed. Please try again.");
      setImportStatus("error");
      trackEvent("composer_zip_import_error");
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting || !isSignedIn) {
      if (!isSignedIn) {
        redirectToSignIn();
      }
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();

    if (!trimmedTitle) {
      setError("Please add a title for your vibe");
      return;
    }

    if (mode === "code" && !code.trim()) {
      setError("Please add some code for your app");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      let effectiveCapsuleId = capsuleId;

      if (mode === "code") {
        // Build a minimal client-static capsule around the inline code.
        const inlineHtmlSource = code.trim();
        const hasHtmlShell = /<html[\s>]/i.test(inlineHtmlSource);
        const html = hasHtmlShell
          ? inlineHtmlSource
          : `<!doctype html><html><head><meta charset="utf-8"><title>Vibecodr App</title></head><body>${inlineHtmlSource}</body></html>`;

        // Derive capabilities from Advanced controls
        const netList = netHosts
          .split(",")
          .map((h) => h.trim())
          .filter((h) => h.length > 0);

        const capabilities = {
          ...(netList.length > 0 ? { net: netList } : {}),
          ...(allowStorage ? { storage: true } : {}),
          ...(allowWorkers ? { workers: true } : {}),
        } as
          | {
              net?: string[];
              storage?: boolean;
              workers?: boolean;
            }
          | undefined;

        // Optional single slider param
        let params: Array<{
          name: string;
          type: "slider";
          label: string;
          default: number;
          min?: number;
          max?: number;
          step?: number;
        }> | undefined;

        if (enableParam) {
          const rawLabel = (paramLabel || "Param").trim();
          const base = rawLabel.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
          const safeBase = base.length > 0 ? base : "param";
          const name = /^[a-zA-Z_]/.test(safeBase) ? safeBase : `p_${safeBase}`;

          params = [
            {
              name,
              type: "slider",
              label: rawLabel || "Intensity",
              default: paramDefault,
              min: paramMin,
              max: paramMax,
              step: paramStep,
            },
          ];
        }

        const manifest = {
          version: "1.0",
          runner: "client-static" as const,
          entry: "index.html",
          title: trimmedTitle,
          description: trimmedDescription || undefined,
          ...(capabilities && Object.keys(capabilities).length > 0 ? { capabilities } : {}),
          ...(params && params.length > 0 ? { params } : {}),
        };

        const formData = new FormData();
        const manifestBlob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
        const manifestFile = new File([manifestBlob], "manifest.json", { type: "application/json" });
        formData.append("manifest", manifestFile);

        const htmlFile = new File([html], "index.html", { type: "text/html" });
        formData.append("index.html", htmlFile);

        const publishResponse = await capsulesApi.publish(formData);

        if (publishResponse.status === 401) {
          redirectToSignIn();
          return;
        }

        const publishData = (await publishResponse.json()) as {
          success?: boolean;
          capsuleId?: string;
          error?: string;
          warnings?: unknown;
        };

        if (!publishResponse.ok || !publishData.success || !publishData.capsuleId) {
          const message = publishData.error || "Failed to publish app. Please check your code and try again.";
          console.error("Inline code publish failed:", message);
          setError(message);
          trackEvent("composer_code_publish_failed", { mode: "code" });
          return;
        }

        effectiveCapsuleId = publishData.capsuleId;
        setCapsuleId(publishData.capsuleId);
        setImportStatus("ready");
      }

      // Determine post type based on capsule
      const type: "app" | "report" = effectiveCapsuleId ? "app" : "report";

      // Create the post
      const response = await postsApi.create({
        title: trimmedTitle,
        description: trimmedDescription || undefined,
        type,
        capsuleId: effectiveCapsuleId ?? undefined,
        coverKey: type === "app" ? coverKey ?? undefined : undefined,
      });

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      if (!response.ok) {
        console.error("Failed to create post:", await response.text());
        setError("Failed to share your vibe. Please try again.");
        trackEvent("composer_submit_failed", { mode, type });
        return;
      }

      const data = (await response.json()) as { id?: string };
      const postId = data.id;

      if (!postId) {
        setError("Post created but missing ID. Please refresh.");
        return;
      }

      // Create optimistic post for immediate feed update
      if (onPostCreated && user) {
        const optimisticPost: FeedPost = {
          id: postId,
          type,
          title: trimmedTitle,
          description: trimmedDescription || undefined,
          author: {
            id: user.id,
            handle: user.username || user.id,
            name: user.fullName || null,
            avatarUrl: user.imageUrl || null,
          },
          capsule: effectiveCapsuleId
            ? {
                id: effectiveCapsuleId,
                runner: "client-static",
                capabilities: undefined,
                params: undefined,
                artifactId: null,
              }
            : null,
          coverKey: type === "app" ? coverKey ?? null : null,
          tags: [],
          stats: {
            runs: 0,
            comments: 0,
            likes: 0,
            remixes: 0,
          },
          createdAt: new Date().toISOString(),
        };

        onPostCreated(optimisticPost);
      }

      // Show success and reset
      toast({
        title: "Vibe shared!",
        description: capsuleId ? "Your app vibe is now live" : "Your vibe is now in the feed",
        variant: "success",
      });

      trackEvent("composer_submit_success", {
        mode,
        type,
        hasCapsule: !!capsuleId,
        hasDescription: !!trimmedDescription,
      });

      // Reset form
      setTitle("");
      setDescription("");
      setCode("");
      setNetHosts("");
      setAllowStorage(false);
      setAllowWorkers(false);
      setEnableParam(false);
      setParamLabel("Intensity");
      setParamDefault(50);
      setParamMin(0);
      setParamMax(100);
      setParamStep(1);
      setCapsuleId(null);
      setImagePreview(null);
      setCoverKey(null);
      setZipFile(null);
      setGithubUrl("");
      setImportStatus("idle");
      setIsExpanded(false);
      setMode("status");
    } catch (err) {
      console.error("Failed to share vibe:", err);
      setError("Failed to share your vibe. Please try again.");
      trackEvent("composer_submit_error", { mode });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenInStudio = () => {
    if (capsuleId) {
      window.location.href = `/studio?capsuleId=${capsuleId}`;
    } else {
      window.location.href = "/studio";
    }
  };

  const clearImage = () => {
    setImagePreview(null);
    setCoverKey(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const clearZip = () => {
    setZipFile(null);
    if (zipInputRef.current) {
      zipInputRef.current.value = "";
    }
  };

  if (!isSignedIn) {
    return (
      <Card className={cn("mb-6", className)}>
        <CardContent className="flex items-center justify-center py-8 text-center">
          <div className="space-y-2">
            <p className="text-muted-foreground">Sign in to share vibes</p>
            <Button onClick={() => redirectToSignIn()}>Sign In</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("mb-6", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Share a Vibe</h2>
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mode Selector */}
          {!isExpanded && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={mode === "status" ? "default" : "outline"}
                size="sm"
                onClick={() => handleModeChange("status")}
              >
                Status
              </Button>
              <Button
                type="button"
                variant={mode === "github" ? "default" : "outline"}
                size="sm"
                className="gap-1"
                onClick={() => handleModeChange("github")}
              >
                <Github className="h-3 w-3" />
                GitHub
              </Button>
              <Button
                type="button"
                variant={mode === "zip" ? "default" : "outline"}
                size="sm"
                className="gap-1"
                onClick={() => handleModeChange("zip")}
              >
                <Upload className="h-3 w-3" />
                ZIP
              </Button>
              <Button
                type="button"
                variant={mode === "code" ? "default" : "outline"}
                size="sm"
                className="gap-1"
                onClick={() => handleModeChange("code")}
              >
                <Code className="h-3 w-3" />
                Code
              </Button>
            </div>
          )}

          {/* Main Input */}
          <div className="space-y-2">
            <Input
              placeholder={
                mode === "github"
                  ? "https://github.com/user/repo"
                  : mode === "status"
                    ? "What's your vibe?"
                    : "Title for your vibe"
              }
              value={mode === "github" && !isExpanded ? githubUrl : title}
              onChange={(e) => {
                if (mode === "github" && !isExpanded) {
                  setGithubUrl(e.target.value);
                } else {
                  handleTextChange(e.target.value);
                }
              }}
              onFocus={() => setIsExpanded(true)}
              disabled={isSubmitting || isImporting}
            />

            {isExpanded && (
              <>
                <Textarea
                  placeholder="Add more details (optional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  disabled={isSubmitting || isImporting}
                />

                {/* Inline Code Section */}
                {mode === "code" && (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Code className="h-4 w-4" />
                      <span className="text-sm font-medium">Inline App Code</span>
                    </div>
                    <Textarea
                      placeholder="Write your app markup (HTML) here. It will run in a sandboxed iframe."
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      rows={10}
                      disabled={isSubmitting || isImporting}
                    />

                    {/* Advanced manifest controls */}
                    <div className="mt-3 space-y-3 border-t pt-3">
                      <div>
                        <p className="text-sm font-medium">Advanced (optional)</p>
                        <p className="text-xs text-muted-foreground">
                          Configure basic capabilities and a simple parameter for this app.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="inline-code-net-hosts" className="text-xs font-medium">
                          Network allowlist (hosts)
                        </Label>
                        <Input
                          id="inline-code-net-hosts"
                          placeholder="api.example.com, data.myapi.com"
                          value={netHosts}
                          onChange={(e) => setNetHosts(e.target.value)}
                          disabled={isSubmitting || isImporting}
                        />
                        <p className="text-xs text-muted-foreground">
                          Comma-separated hosts. Leave empty for no network access.
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <Label htmlFor="inline-code-storage" className="text-xs font-medium">
                            Allow storage
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Enable IndexedDB access for this app.
                          </p>
                        </div>
                        <Switch
                          id="inline-code-storage"
                          checked={allowStorage}
                          onCheckedChange={(checked) => setAllowStorage(Boolean(checked))}
                          disabled={isSubmitting || isImporting}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <Label htmlFor="inline-code-workers" className="text-xs font-medium">
                            Allow Web Workers
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Let this app spawn Web Workers.
                          </p>
                        </div>
                        <Switch
                          id="inline-code-workers"
                          checked={allowWorkers}
                          onCheckedChange={(checked) => setAllowWorkers(Boolean(checked))}
                          disabled={isSubmitting || isImporting}
                        />
                      </div>

                      <div className="mt-2 space-y-2 border-t pt-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="space-y-1">
                            <span className="text-xs font-medium">Parameter (optional)</span>
                            <p className="text-xs text-muted-foreground">
                              Expose a single slider to control your app.
                            </p>
                          </div>
                          <Switch
                            id="inline-code-param"
                            checked={enableParam}
                            onCheckedChange={(checked) => setEnableParam(Boolean(checked))}
                            disabled={isSubmitting || isImporting}
                          />
                        </div>

                        {enableParam && (
                          <div className="grid grid-cols-2 gap-3 pt-1">
                            <div className="space-y-1">
                              <Label htmlFor="inline-code-param-label" className="text-xs font-medium">
                                Label
                              </Label>
                              <Input
                                id="inline-code-param-label"
                                value={paramLabel}
                                onChange={(e) => setParamLabel(e.target.value)}
                                disabled={isSubmitting || isImporting}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="inline-code-param-default" className="text-xs font-medium">
                                Default
                              </Label>
                              <Input
                                id="inline-code-param-default"
                                type="number"
                                value={paramDefault}
                                onChange={(e) => setParamDefault(Number(e.target.value) || 0)}
                                disabled={isSubmitting || isImporting}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="inline-code-param-min" className="text-xs font-medium">
                                Min
                              </Label>
                              <Input
                                id="inline-code-param-min"
                                type="number"
                                value={paramMin}
                                onChange={(e) => setParamMin(Number(e.target.value) || 0)}
                                disabled={isSubmitting || isImporting}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="inline-code-param-max" className="text-xs font-medium">
                                Max
                              </Label>
                              <Input
                                id="inline-code-param-max"
                                type="number"
                                value={paramMax}
                                onChange={(e) => setParamMax(Number(e.target.value) || 0)}
                                disabled={isSubmitting || isImporting}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="inline-code-param-step" className="text-xs font-medium">
                                Step
                              </Label>
                              <Input
                                id="inline-code-param-step"
                                type="number"
                                value={paramStep}
                                onChange={(e) => setParamStep(Number(e.target.value) || 1)}
                                disabled={isSubmitting || isImporting}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {/* GitHub Import Section */}
                {mode === "github" && (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Github className="h-4 w-4" />
                      <span className="text-sm font-medium">Import from GitHub</span>
                    </div>
                    <Input
                      placeholder="https://github.com/user/repo"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      disabled={isImporting || hasImportedCapsule}
                    />
                    {!hasImportedCapsule && (
                      <Button
                        type="button"
                        onClick={handleGithubImport}
                        disabled={!githubUrl.trim() || isImporting}
                        size="sm"
                        className="gap-2"
                      >
                        {isImporting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          "Import Repository"
                        )}
                      </Button>
                    )}
                    {importError && (
                      <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <span>{importError}</span>
                      </div>
                    )}
                    {hasImportedCapsule && (
                      <div className="flex items-start gap-2 rounded-md bg-green-500/10 p-2 text-sm text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <span>Repository imported successfully</span>
                      </div>
                    )}
                  </div>
                )}

                {/* ZIP Upload Section */}
                {mode === "zip" && (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      <span className="text-sm font-medium">Upload ZIP</span>
                    </div>
                    <input
                      ref={zipInputRef}
                      type="file"
                      accept=".zip"
                      onChange={handleZipSelect}
                      className="hidden"
                    />
                    {!zipFile && !hasImportedCapsule && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => zipInputRef.current?.click()}
                        disabled={isImporting}
                      >
                        Select ZIP File
                      </Button>
                    )}
                    {zipFile && !hasImportedCapsule && (
                      <div className="flex items-center justify-between rounded-md bg-muted p-2">
                        <span className="text-sm">{zipFile.name}</span>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            onClick={handleZipImport}
                            disabled={isImporting}
                            size="sm"
                            className="gap-2"
                          >
                            {isImporting ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Importing...
                              </>
                            ) : (
                              "Import"
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={clearZip}
                            disabled={isImporting}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                    {importError && (
                      <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <span>{importError}</span>
                      </div>
                    )}
                    {hasImportedCapsule && (
                      <div className="flex items-start gap-2 rounded-md bg-green-500/10 p-2 text-sm text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <span>ZIP imported successfully</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Image Upload Section (cover for app vibes) */}
                {hasImportedCapsule && (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      <span className="text-sm font-medium">Add Image</span>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                    {!imagePreview && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSubmitting || isUploadingCover}
                      >
                        Select Image
                      </Button>
                    )}
                    {imagePreview && (
                      <div className="space-y-2">
                        <div className="relative aspect-video w-full overflow-hidden rounded-md">
                          <img
                            src={imagePreview}
                            alt="Preview"
                            className="h-full w-full object-cover"
                          />
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute right-2 top-2"
                            onClick={clearImage}
                            disabled={isSubmitting || isUploadingCover}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          {isExpanded && (
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {hasImportedCapsule && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenInStudio}
                  >
                    Open in Studio
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsExpanded(false);
                    setTitle("");
                    setDescription("");
                    setCode("");
                    setNetHosts("");
                    setAllowStorage(false);
                    setAllowWorkers(false);
                    setEnableParam(false);
                    setParamLabel("Intensity");
                    setParamDefault(50);
                    setParamMin(0);
                    setParamMax(100);
                    setParamStep(1);
                    setError(null);
                  }}
                  disabled={isSubmitting || isImporting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    isSubmitting ||
                    isImporting ||
                    isUploadingCover ||
                    !title.trim() ||
                    (mode === "github" && !hasImportedCapsule && !!githubUrl.trim()) ||
                    (mode === "zip" && !!zipFile && !hasImportedCapsule)
                  }
                  className="gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sharing...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Share Vibe
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
