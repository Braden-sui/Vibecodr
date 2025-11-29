"use client";

import { useState, useRef, useCallback, FormEvent, ChangeEvent } from "react";
import { motion } from "motion/react";
import { useUser } from "@clerk/clerk-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Send,
  Image as ImageIcon,
  Github,
  Upload,
  Code,
  FileText,
  Link2,
  X,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Tag,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { redirectToSignIn, useBuildAuthInit } from "@/lib/client-auth";
import { toast } from "@/lib/toast";
import { postsApi, coversApi, type FeedPost } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { formatBytes } from "@/lib/zipBundle";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { featuredTags } from "@/lib/tags";
import { InlinePreviewFrame } from "@/components/runtime/InlinePreviewFrame";
import { usePostComposer, MAX_TAGS, type VibeType } from "@/components/vibes/usePostComposer";
import { AppImportProgress } from "@/components/vibes/AppImportProgress";
import { AppSourceSelector } from "@/components/vibes/AppSourceSelector";
import { useAppImport } from "@/components/vibes/useAppImport";

export interface VibesComposerProps {
  onPostCreated?: (post: FeedPost) => void;
  className?: string;
}

const formatErrorMessage = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    if ("message" in value && typeof (value as { message?: unknown }).message === "string") {
      return (value as { message: string }).message;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const toWarningText = (warning: string | { path?: string; message: string }): string => {
  if (typeof warning === "string") return warning;
  if (warning.path) {
    return `${warning.path}: ${warning.message}`;
  }
  return warning.message;
};

/**
 * VibesComposer - Unified composer for social post types with a bounded app sub-flow.
 * Users pick a vibe type, then (for apps) complete an attach flow with its own progress rail.
 */
export function VibesComposer({ onPostCreated, className }: VibesComposerProps) {
  const { user, isSignedIn } = useUser();

  const [composerError, setComposerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);

  const {
    vibeType,
    setVibeType,
    isExpanded,
    setIsExpanded,
    title,
    setTitle,
    description,
    setDescription,
    linkUrl,
    setLinkUrl,
    tagInput,
    setTagInput,
    selectedTags,
    addTag,
    removeTag,
    handleTagKeyDown,
    clearTags,
    resetPost,
  } = usePostComposer();

  const suggestTitleIfEmpty = useCallback(
    (value: string) => {
      if (!title.trim()) {
        setTitle(value);
      }
    },
    [setTitle, title],
  );

  const getTitleValue = useCallback(() => title, [title]);
  const getDescriptionValue = useCallback(() => description, [description]);
  const buildAuthInit = useBuildAuthInit();

  const {
    appMode,
    handleAppModeChange,
    appAttachment,
    appProgress,
    appError,
    githubUrl,
    setGithubUrl,
    zipFile,
    zipSummary,
    zipImportWarnings,
    code,
    setCode,
    allowStorage,
    setAllowStorage,
    enableParam,
    setEnableParam,
    paramLabel,
    setParamLabel,
    paramDefault,
    setParamDefault,
    paramMin,
    setParamMin,
    paramMax,
    setParamMax,
    paramStep,
    setParamStep,
    debouncedCode,
    previewError,
    showPreview,
    setShowPreview,
    isAppBusy,
    hasAttachedApp,
    zipInputRef,
    handleZipSelect,
    handleGithubImport,
    handleZipImport,
    buildInlineApp,
    handlePreviewReady,
    handlePreviewError,
    clearZip,
    resetInlineAdvanced,
    resetAppFlow,
    clearAttachment,
  } = useAppImport({
    buildAuthInit,
    onRequireAuth: redirectToSignIn,
    onTitleSuggestion: suggestTitleIfEmpty,
    getTitle: getTitleValue,
    getDescription: getDescriptionValue,
    onComposerError: setComposerError,
    onClearComposerError: () => setComposerError(null),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const prefersReducedMotion = useReducedMotion();
  const isAppVibe = vibeType === "app";
  const isImageVibe = vibeType === "image";
  const isLinkVibe = vibeType === "link";
  const isLongformVibe = vibeType === "longform";
  const isThoughtVibe = vibeType === "thought";
  const isGithubMode = isAppVibe && appMode === "github";
  const isZipMode = isAppVibe && appMode === "zip";
  const isCodeMode = isAppVibe && appMode === "code";

  const resetComposer = () => {
    resetPost();
    setCode("");
    resetInlineAdvanced();
    setComposerError(null);
    handleAppModeChange("github");
    resetAppFlow();
    setImagePreview(null);
    setCoverKey(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleTextChange = (value: string) => {
    setTitle(value);

    const githubPattern = /https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+/i;
    if (githubPattern.test(value) && !isAppVibe) {
      setVibeType("app");
      handleAppModeChange("github");
      setGithubUrl(value);
      setIsExpanded(true);
      trackEvent("composer_mode_detected", { type: "app", appMode: "github" });
    }
  };

  const handleVibeTypeChange = (nextType: VibeType) => {
    setVibeType(nextType);
    setComposerError(null);

    if (nextType !== "app") {
      resetAppFlow();
      clearTags();
    }

    if (nextType !== "link") {
      setLinkUrl("");
    }

    trackEvent("composer_mode_changed", { type: nextType });
  };

  const handleImageSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setComposerError("Please select a valid image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setComposerError("Image must be under 5MB");
      return;
    }

    if (isAppVibe && !hasAttachedApp) {
      setComposerError("Attach an app before adding a cover image.");
      return;
    }

    setComposerError(null);

    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    try {
      setIsUploadingCover(true);
      const init = await buildAuthInit();
      const response = await coversApi.upload(file, init);

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      const data = (await response.json()) as { ok?: boolean; key?: string; error?: string };

      if (!response.ok || !data.ok || !data.key) {
        const message = data.error || "Failed to upload image. Please try again.";
        console.error("Cover upload failed:", message);
        setComposerError(message);
        setImagePreview(null);
        setCoverKey(null);
        return;
      }

      setCoverKey(data.key);
    } catch (err) {
      console.error("Cover upload error:", err);
      setComposerError("Failed to upload image. Please try again.");
      setImagePreview(null);
      setCoverKey(null);
    } finally {
      setIsUploadingCover(false);
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
    const trimmedLink = linkUrl.trim();
    let effectiveTitle = trimmedTitle;

    if (isLinkVibe) {
      if (!trimmedLink) {
        setComposerError("Please add a link to share");
        return;
      }
      let parsedLink: URL | null = null;
      try {
        parsedLink = new URL(trimmedLink);
      } catch (err) {
        console.error("E-VIBECODR-0201 invalid link vibe url", {
          raw: trimmedLink,
          error: err instanceof Error ? err.message : String(err),
        });
        setComposerError("Please enter a valid link URL");
        return;
      }
      if (!effectiveTitle) {
        effectiveTitle = parsedLink.hostname || trimmedLink;
      }
    } else if (!effectiveTitle) {
      setComposerError("Please add a title for your vibe");
      return;
    }

    if (isAppVibe && !hasAttachedApp) {
      setComposerError("Attach an app before sharing it to the feed.");
      return;
    }

    if (isImageVibe && !coverKey) {
      setComposerError("Add an image before sharing this vibe.");
      return;
    }

    setComposerError(null);
    setIsSubmitting(true);

    try {
      const type: VibeType = isAppVibe ? "app" : vibeType;
      const descriptionPayload =
        isLinkVibe
          ? [trimmedDescription, trimmedLink].filter(Boolean).join("\n\n") || undefined
          : trimmedDescription || undefined;
      const tagsForPost = isAppVibe ? selectedTags : [];
      const coverPayload = isImageVibe || isAppVibe ? coverKey ?? undefined : undefined;

      const init = await buildAuthInit();
      const response = await postsApi.create(
        {
          title: effectiveTitle,
          description: descriptionPayload,
          type,
          capsuleId: hasAttachedApp ? appAttachment?.capsuleId : undefined,
          coverKey: coverPayload,
          tags: tagsForPost.length > 0 ? tagsForPost : undefined,
        },
        init,
      );

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      if (!response.ok) {
        console.error("Failed to create post:", await response.text());
        setComposerError("Failed to share your vibe. Please try again.");
        trackEvent("composer_submit_failed", { type, appMode });
        return;
      }

      const data = (await response.json()) as { id?: string };
      const postId = data.id;

      if (!postId) {
        setComposerError("Post created but missing ID. Please refresh.");
        return;
      }

      if (onPostCreated && user) {
        const optimisticPost: FeedPost = {
          id: postId,
          type,
          title: effectiveTitle,
          description: descriptionPayload,
          author: {
            id: user.id,
            handle: user.username || user.id,
            name: user.fullName || null,
            avatarUrl: user.imageUrl || null,
          },
          capsule:
            isAppVibe && hasAttachedApp && appAttachment
              ? {
                  id: appAttachment.capsuleId,
                  runner: "client-static",
                  capabilities: undefined,
                  params: undefined,
                  artifactId: null,
                }
              : null,
          coverKey: coverPayload ?? null,
          tags: tagsForPost,
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

      toast({
        title: "Vibe shared!",
        description:
          type === "app"
            ? "Your app vibe is now live"
            : type === "image"
              ? "Your image vibe is now in the feed"
              : type === "link"
                ? "Your link is now live in the feed"
                : "Your vibe is now in the feed",
        variant: "success",
      });

      trackEvent("composer_submit_success", {
        type,
        appMode,
        hasCapsule: hasAttachedApp,
        hasDescription: !!descriptionPayload,
      });

      resetComposer();
    } catch (err) {
      console.error("Failed to share vibe:", err);
      setComposerError("Failed to share your vibe. Please try again.");
      trackEvent("composer_submit_error", { type: vibeType, appMode });
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearImage = () => {
    setImagePreview(null);
    setCoverKey(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (!isSignedIn) {
    return (
      <motion.section
        initial={prefersReducedMotion ? undefined : { opacity: 0, y: 12 }}
        animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <Card className={cn("mb-6", className)}>
          <CardContent className="flex items-center justify-center py-8 text-center">
            <div className="space-y-2">
              <p className="text-muted-foreground">Sign in to share vibes</p>
              <Button onClick={() => redirectToSignIn()}>Sign In</Button>
            </div>
          </CardContent>
        </Card>
      </motion.section>
    );
  }

  const titlePlaceholder =
    isGithubMode && !isExpanded
      ? "https://github.com/user/repo"
      : isAppVibe
        ? "Title for your app"
        : isImageVibe
          ? "Title for your image vibe"
          : isLinkVibe
            ? "Title for your link"
            : isLongformVibe
              ? "Title for your longform vibe"
              : "What's your vibe?";
  const descriptionPlaceholder =
    isLinkVibe
      ? "Add context for your link (optional)"
      : isImageVibe
        ? "Add a caption (optional)"
        : isLongformVibe
          ? "Share your longform vibe"
          : isAppVibe
            ? "Describe your app vibe (optional)"
            : "Add more details (optional)";
  const submitDisabled =
    isSubmitting ||
    isAppBusy ||
    isUploadingCover ||
    (isLinkVibe && !linkUrl.trim()) ||
    (!title.trim() && !isLinkVibe) ||
    (isAppVibe && !hasAttachedApp) ||
    (isImageVibe && !coverKey);
  return (
    <motion.section
      layout
      initial={prefersReducedMotion ? undefined : { opacity: 0, y: 10 }}
      animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className={cn("mb-6 overflow-hidden", className)}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Share a Vibe</h2>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={vibeType === "thought" ? "default" : "outline"}
                size="sm"
                className="gap-1"
                onClick={() => handleVibeTypeChange("thought")}
              >
                <Sparkles className="h-3 w-3" />
                Thought
              </Button>
              <Button
                type="button"
                variant={vibeType === "image" ? "default" : "outline"}
                size="sm"
                className="gap-1"
                onClick={() => handleVibeTypeChange("image")}
              >
                <ImageIcon className="h-3 w-3" />
                Image
              </Button>
              <Button
                type="button"
                variant={vibeType === "link" ? "default" : "outline"}
                size="sm"
                className="gap-1"
                onClick={() => handleVibeTypeChange("link")}
              >
                <Link2 className="h-3 w-3" />
                Link
              </Button>
              <Button
                type="button"
                variant={vibeType === "app" ? "default" : "outline"}
                size="sm"
                className="gap-1"
                onClick={() => handleVibeTypeChange("app")}
              >
                <Code className="h-3 w-3" />
                App
              </Button>
            <Button
              type="button"
              variant={vibeType === "longform" ? "default" : "outline"}
              size="sm"
              className="gap-1"
                onClick={() => handleVibeTypeChange("longform")}
              >
                <FileText className="h-3 w-3" />
                Longform
              </Button>
            </div>
            {isAppVibe && (
              <AppSourceSelector
                appMode={appMode}
                onSelect={handleAppModeChange}
                disabled={isSubmitting || isAppBusy}
                className="mt-2"
              />
            )}

            <div className="space-y-2">
              <Input
                placeholder={titlePlaceholder}
                value={isGithubMode && !isExpanded ? githubUrl : title}
                onChange={(e) => {
                  if (isGithubMode && !isExpanded) {
                    setGithubUrl(e.target.value);
                  } else {
                    handleTextChange(e.target.value);
                  }
                }}
                onFocus={() => setIsExpanded(true)}
                disabled={isSubmitting || isAppBusy}
              />

              {isExpanded && (
                <>
                  {isLinkVibe && (
                    <div className="space-y-1">
                      <Label htmlFor="vibe-link-url" className="text-xs font-medium">
                        Link URL
                      </Label>
                      <Input
                        id="vibe-link-url"
                        type="url"
                        placeholder="https://example.com/your-link"
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        disabled={isSubmitting || isAppBusy}
                      />
                    </div>
                  )}

                  {!isThoughtVibe && (
                    <Textarea
                      placeholder={descriptionPlaceholder}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={isLongformVibe ? 6 : 3}
                      disabled={isSubmitting || isAppBusy}
                    />
                  )}
                  {isAppVibe && (
                    <div className="space-y-3 rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Code className="h-4 w-4" />
                          <div>
                            <p className="text-sm font-medium">Attach an app</p>
                            <p className="text-xs text-muted-foreground">
                              Pick a source, let us build, then attach the app before posting.
                            </p>
                          </div>
                        </div>
                        {hasAttachedApp && <Badge variant="secondary">App attached</Badge>}
                      </div>

                      <AppImportProgress progress={appProgress} hasAttachedApp={hasAttachedApp} />
                      {isGithubMode && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="flex items-center gap-2">
                            <Github className="h-4 w-4" />
                            <span className="text-sm font-medium">Import from GitHub</span>
                          </div>
                          <Input
                            placeholder="https://github.com/user/repo"
                            value={githubUrl}
                            onChange={(e) => setGithubUrl(e.target.value)}
                            disabled={isAppBusy}
                          />
                          {!hasAttachedApp && (
                            <Button
                              type="button"
                              onClick={handleGithubImport}
                              disabled={!githubUrl.trim() || isAppBusy}
                              size="sm"
                              className="gap-2"
                            >
                              {isAppBusy ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Importing...
                                </>
                              ) : (
                                "Import & attach"
                              )}
                            </Button>
                          )}
                          {appError && (
                            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                              <span>{appError}</span>
                            </div>
                          )}
                          {hasAttachedApp && appAttachment?.source === "github" && (
                            <div className="flex items-start gap-2 rounded-md bg-green-500/10 p-2 text-sm text-green-700 dark:text-green-400">
                              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                              <span>Repository imported and attached</span>
                            </div>
                          )}
                        </div>
                      )}
                      {isZipMode && (
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
                          {!zipFile && !hasAttachedApp && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => zipInputRef.current?.click()}
                              disabled={isAppBusy}
                            >
                              Select ZIP File
                            </Button>
                          )}
                          {zipFile && !hasAttachedApp && (
                            <div className="flex items-center justify-between rounded-md bg-muted p-2">
                              <span className="text-sm">{zipFile.name}</span>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  onClick={handleZipImport}
                                  disabled={isAppBusy}
                                  size="sm"
                                  className="gap-2"
                                >
                                  {isAppBusy ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Importing...
                                    </>
                                  ) : (
                                    "Upload & attach"
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={clearZip}
                                  disabled={isAppBusy}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          )}
                          {appError && isZipMode && (
                            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                              <span>{appError}</span>
                            </div>
                          )}
                          {hasAttachedApp && appAttachment?.source === "zip" && (
                            <div className="flex items-start gap-2 rounded-md bg-green-500/10 p-2 text-sm text-green-700 dark:text-green-400">
                              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                              <span>ZIP uploaded and attached</span>
                            </div>
                          )}
                          {zipSummary && (
                            <div className="space-y-2 rounded-md border p-3 text-xs">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-medium">{zipSummary.fileName}</p>
                                  <p className="text-xs text-muted-foreground">{formatBytes(zipSummary.totalSize)}</p>
                                </div>
                                <Button variant="ghost" size="sm" onClick={clearZip}>
                                  Replace ZIP
                                </Button>
                              </div>
                              {zipImportWarnings.length > 0 && (
                                <div className="space-y-1 rounded-md bg-yellow-500/10 p-2 text-yellow-700 dark:text-yellow-400">
                                  <p className="text-xs font-medium">Import warnings</p>
                                  {zipImportWarnings.slice(0, 5).map((warning, index) => (
                                    <p key={`import-warning-${index}`}>{toWarningText(warning)}</p>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {isCodeMode && (
                        <div className="space-y-2 rounded-md border p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Code className="h-4 w-4" />
                              <span className="text-sm font-medium">Inline App Code</span>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowPreview(!showPreview)}
                              className="gap-1 text-xs"
                            >
                              {showPreview ? "Hide" : "Show"} Preview
                            </Button>
                          </div>
                          
                          {/* Split view: code editor + live preview */}
                          <div className={cn(
                            "grid gap-3",
                            showPreview ? "md:grid-cols-2" : "grid-cols-1"
                          )}>
                            {/* Code editor */}
                            <div className="space-y-2">
                              <Textarea
                                placeholder={`// Write JSX code with live preview!\n// Example:\nexport default function App() {\n  return <h1>Hello, World!</h1>;\n}`}
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                rows={12}
                                disabled={isSubmitting || isAppBusy}
                                className="font-mono text-sm"
                              />
                            </div>
                            
                            {/* Live preview panel */}
                            {showPreview && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-muted-foreground">Live Preview</span>
                                  {previewError && (
                                    <Badge variant="destructive" className="text-xs">
                                      Error
                                    </Badge>
                                  )}
                                </div>
                                <div className="relative h-[280px] overflow-hidden rounded-md border bg-white">
                                  <InlinePreviewFrame
                                    code={debouncedCode}
                                    onReady={handlePreviewReady}
                                    onError={handlePreviewError}
                                    className="h-full w-full"
                                  />
                                </div>
                                {previewError && (
                                  <p className="text-xs text-destructive">{previewError}</p>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="mt-3 space-y-3 border-t pt-3">
                            <div>
                              <p className="text-sm font-medium">Advanced (optional)</p>
                              <p className="text-xs text-muted-foreground">
                                Configure basic capabilities and a simple parameter for this app.
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Outbound network access is disabled until premium VM tiers launch.
                              </p>
                            </div>

                            <div className="flex items-center justify-between gap-4">
                              <div className="space-y-1">
                                <Label htmlFor="inline-code-storage" className="text-xs font-medium">
                                  Allow storage
                                </Label>
                                <p className="text-xs text-muted-foreground">Enable IndexedDB access for this app.</p>
                              </div>
                              <Switch
                                id="inline-code-storage"
                                checked={allowStorage}
                                onCheckedChange={(checked) => setAllowStorage(Boolean(checked))}
                                disabled={isSubmitting || isAppBusy}
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
                                  disabled={isSubmitting || isAppBusy}
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
                                      disabled={isSubmitting || isAppBusy}
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
                                      disabled={isSubmitting || isAppBusy}
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
                                      disabled={isSubmitting || isAppBusy}
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
                                      disabled={isSubmitting || isAppBusy}
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
                                      disabled={isSubmitting || isAppBusy}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={buildInlineApp}
                              disabled={isAppBusy || !code.trim()}
                              className="gap-2"
                            >
                              {isAppBusy ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Building...
                                </>
                              ) : (
                                <>
                                  <Code className="h-4 w-4" />
                                  Build & attach app
                                </>
                              )}
                            </Button>
                            {hasAttachedApp && appAttachment?.source === "code" && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={clearAttachment}
                                className="gap-1"
                              >
                                <RefreshCw className="h-4 w-4" />
                                Rebuild
                              </Button>
                            )}
                            {appError && (
                              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                <span>{appError}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {hasAttachedApp && (
                        <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold">
                                Attached app: {appAttachment?.title || "Untitled app"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Source: {appAttachment?.source.toUpperCase()} - Capsule ID: {appAttachment?.capsuleId}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={clearAttachment}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                          {appAttachment?.warnings && appAttachment.warnings.length > 0 && (
                            <div className="space-y-1 rounded-md bg-yellow-500/10 p-2 text-yellow-700 dark:text-yellow-400">
                              <p className="text-xs font-medium">Warnings</p>
                              {appAttachment.warnings.slice(0, 4).map((warning, index) => (
                                <p key={`app-warning-${index}`} className="text-xs">
                                  {toWarningText(warning)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="space-y-2 rounded-md border p-3">
                        <div className="flex items-center gap-2">
                          <Tag className="h-4 w-4" />
                          <span className="text-sm font-medium">Tags (apps)</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Add up to {MAX_TAGS} tags to help Vibecoders find this app.
                        </p>
                        {selectedTags.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {selectedTags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs"
                              >
                                #{tag}
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground"
                                  onClick={() => removeTag(tag)}
                                  aria-label={`Remove ${tag} tag`}
                                  disabled={isSubmitting || isAppBusy}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {selectedTags.length < MAX_TAGS && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              placeholder="e.g. ai, cli, canvas"
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={handleTagKeyDown}
                              disabled={isSubmitting || isAppBusy}
                              className="w-48"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addTag(tagInput)}
                              disabled={!tagInput.trim() || isSubmitting || isAppBusy}
                            >
                              Add tag
                            </Button>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {featuredTags.map((tag) => {
                            const active = selectedTags.includes(tag);
                            const atLimit = selectedTags.length >= MAX_TAGS && !active;
                            return (
                              <Button
                                key={tag}
                                type="button"
                                variant={active ? "secondary" : "ghost"}
                                size="sm"
                                className="h-8 px-3"
                                onClick={() => addTag(tag)}
                                disabled={atLimit || isSubmitting || isAppBusy}
                              >
                                #{tag}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  {(isImageVibe || (isAppVibe && hasAttachedApp)) && (
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
                            <img src={imagePreview ?? ""} alt="Preview" className="h-full w-full object-cover" />
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

            {composerError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{formatErrorMessage(composerError)}</span>
              </div>
            )}

            {isExpanded && (
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetComposer}
                  disabled={isSubmitting || isAppBusy}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={submitDisabled} className="gap-2">
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
            )}
          </form>
        </CardContent>
      </Card>
    </motion.section>
  );
}
