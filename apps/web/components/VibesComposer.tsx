"use client";

import { useState, useRef, FormEvent, ChangeEvent, KeyboardEvent } from "react";
import { motion } from "motion/react";
import { useUser, useAuth } from "@clerk/clerk-react";
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
  FileText,
  Link2,
  X,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { redirectToSignIn } from "@/lib/client-auth";
import { toast } from "@/lib/toast";
import { postsApi, capsulesApi, coversApi, type FeedPost } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import {
  analyzeZipFile,
  buildCapsuleFormData,
  formatBytes,
  type ZipManifestIssue,
} from "@/lib/zipBundle";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { featuredTags, normalizeTag } from "@/lib/tags";

type VibeType = FeedPost["type"];
type AppComposerMode = "github" | "zip" | "code";

type ImportStatus = "idle" | "importing" | "ready" | "error";

export interface VibesComposerProps {
  onPostCreated?: (post: FeedPost) => void;
  className?: string;
}

const MAX_TAGS = 3;

const formatErrorMessage = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    const maybe = (value as any).message;
    if (typeof maybe === "string") return maybe;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

/**
 * VibesComposer - Unified composer for all vibe creation modes
 * Handles text/status posts, image attachments, GitHub imports, ZIP uploads, and inline code
 */
export function VibesComposer({ onPostCreated, className }: VibesComposerProps) {
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [vibeType, setVibeType] = useState<VibeType>("thought");
  const [appMode, setAppMode] = useState<AppComposerMode>("github");
  const [isExpanded, setIsExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildAuthInit = async (): Promise<RequestInit | undefined> => {
    if (typeof getToken !== "function") return undefined;
    const token = await getToken({ template: "workers" });
    if (!token) return undefined;
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  };

  // GitHub import state
  const [githubUrl, setGithubUrl] = useState("");
  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const [capsuleId, setCapsuleId] = useState<string | null>(null);
  const [capsuleSource, setCapsuleSource] = useState<"github" | "zip" | "code" | null>(null);

  // Image state
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);

  // ZIP state
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipSummary, setZipSummary] = useState<{ fileName: string; totalSize: number } | null>(null);
  const [zipManifestWarnings, setZipManifestWarnings] = useState<ZipManifestIssue[]>([]);
  const [zipPublishWarnings, setZipPublishWarnings] = useState<string[]>([]);

  // Inline code state
  const [code, setCode] = useState("");

  // Inline capabilities & params (Advanced section)
  const [allowStorage, setAllowStorage] = useState(false);
  const [enableParam, setEnableParam] = useState(false);
  const [paramLabel, setParamLabel] = useState("Intensity");
  const [paramDefault, setParamDefault] = useState(50);
  const [paramMin, setParamMin] = useState(0);
  const [paramMax, setParamMax] = useState(100);
  const [paramStep, setParamStep] = useState(1);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const isImporting = importStatus === "importing";
  const hasImportedCapsule = !!capsuleId;
  const isAppVibe = vibeType === "app";
  const isImageVibe = vibeType === "image";
  const isLinkVibe = vibeType === "link";
  const isLongformVibe = vibeType === "longform";
  const isThoughtVibe = vibeType === "thought";
  const requiresCapsuleImport = isAppVibe && appMode !== "code";
  const isTagLimitReached = selectedTags.length >= MAX_TAGS;
  const prefersReducedMotion = useReducedMotion();

  // Auto-detect GitHub URLs in text input
  const handleTextChange = (value: string) => {
    setTitle(value);

    // Auto-detect GitHub URL
    const githubPattern = /https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+/i;
    if (githubPattern.test(value) && !isAppVibe) {
      setVibeType("app");
      setAppMode("github");
      setGithubUrl(value);
      trackEvent("composer_mode_detected", { type: "app", appMode: "github" });
    }
  };

  const handleVibeTypeChange = (nextType: VibeType) => {
    setVibeType(nextType);
    setError(null);
    setImportError(null);
    if (nextType !== "app") {
      setImportStatus("idle");
      setSelectedTags([]);
      setTagInput("");
    }
    if (nextType !== "link") {
      setLinkUrl("");
    }
    trackEvent("composer_mode_changed", { type: nextType });
  };

  const handleAppModeChange = (nextMode: AppComposerMode) => {
    setAppMode(nextMode);
    setError(null);
    setImportError(null);
    trackEvent("composer_app_mode_changed", { appMode: nextMode });
  };

  const addTag = (raw: string) => {
    const normalized = normalizeTag(raw);
    if (!normalized) {
      setTagInput("");
      return;
    }

    setSelectedTags((prev) => {
      if (prev.includes(normalized) || prev.length >= MAX_TAGS) {
        return prev;
      }
      return [...prev, normalized];
    });
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      event.preventDefault();
      addTag(tagInput);
    }
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

    if (!capsuleId && !isImageVibe) {
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
    setImportError(null);
    setZipSummary(null);
    setZipManifestWarnings([]);
    setZipPublishWarnings([]);
    setImportStatus("idle");
  };

  const handleGithubImport = async () => {
    const trimmedUrl = githubUrl.trim();
    if (!trimmedUrl || isImporting) return;

    setVibeType("app");
    setAppMode("github");
    setImportError(null);
    setZipSummary(null);
    setZipManifestWarnings([]);
    setZipPublishWarnings([]);
    setImportStatus("importing");

    try {
      const init = await buildAuthInit();
      const response = await capsulesApi.importGithub({ url: trimmedUrl }, init);

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
      setCapsuleSource("github");
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

    setVibeType("app");
    setAppMode("zip");
    setImportError(null);
    setImportStatus("importing");
    setZipManifestWarnings([]);
    setZipPublishWarnings([]);

    try {
      const analysis = await analyzeZipFile(zipFile);

      if (analysis.errors && analysis.errors.length > 0) {
        setZipSummary({
          fileName: zipFile.name,
          totalSize: analysis.totalSize,
        });
        setZipManifestWarnings(analysis.errors);
        setImportStatus("error");
        setImportError("Manifest validation failed. Please fix the issues in manifest.json.");
        trackEvent("composer_zip_import_failed", { error: "manifest-invalid" });
        return;
      }

      setZipSummary({
        fileName: zipFile.name,
        totalSize: analysis.totalSize,
      });
      setZipManifestWarnings(analysis.warnings ?? []);

      const formData = buildCapsuleFormData(analysis.manifest, analysis.files);
      const init = await buildAuthInit();
      const response = await capsulesApi.publish(formData, init);

      if (response.status === 401) {
        redirectToSignIn();
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
        trackEvent("composer_zip_import_failed", { error: message });
        return;
      }

      setCapsuleId(data.capsuleId);
      setCapsuleSource("zip");
      setZipPublishWarnings(data.warnings ?? []);
      if (!title.trim() && analysis.manifest.title) {
        setTitle(analysis.manifest.title);
      }
      setImportStatus("ready");
      trackEvent("composer_zip_import_success", { capsuleId: data.capsuleId });
      setZipFile(null);
      if (zipInputRef.current) {
        zipInputRef.current.value = "";
      }
    } catch (err) {
      console.error("Failed to import ZIP:", err);
      setImportError(
        err instanceof Error ? err.message : "Upload failed. Please check your ZIP and try again."
      );
      setImportStatus("error");
      setZipSummary(null);
      setZipManifestWarnings([]);
      setZipPublishWarnings([]);
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
    const trimmedLink = linkUrl.trim();
    let effectiveTitle = trimmedTitle;

    if (isLinkVibe) {
      if (!trimmedLink) {
        setError("Please add a link to share");
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
        setError("Please enter a valid link URL");
        return;
      }
      if (!effectiveTitle) {
        effectiveTitle = parsedLink.hostname || trimmedLink;
      }
    } else if (!effectiveTitle) {
      setError("Please add a title for your vibe");
      return;
    }

    if (isAppVibe && appMode === "code" && !code.trim()) {
      setError("Please add some code for your app");
      return;
    }

    if (isAppVibe && requiresCapsuleImport && !hasImportedCapsule) {
      setError("Import your app before sharing it to the feed.");
      return;
    }

    if (isImageVibe && !coverKey) {
      setError("Add an image before sharing this vibe.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      let effectiveCapsuleId = isAppVibe ? capsuleId : null;

      if (isAppVibe && appMode === "code") {
        const userSource = code.trim();
        // Derive capabilities from Advanced controls (network disabled until premium tiers)
        const capabilities = allowStorage ? ({ storage: true } as { storage?: boolean }) : undefined;

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
          runner: "webcontainer" as const,
          entry: "entry.tsx",
          title: trimmedTitle,
          description: trimmedDescription || undefined,
          ...(capabilities && Object.keys(capabilities).length > 0 ? { capabilities } : {}),
          ...(params && params.length > 0 ? { params } : {}),
        };

        const formData = new FormData();
        const manifestBlob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
        const manifestFile = new File([manifestBlob], "manifest.json", { type: "application/json" });
        formData.append("manifest", manifestFile);

        const entryShim = `
import React from "react";
import ReactDOM from "react-dom/client";
import UserApp from "./user-code";

const root = document.getElementById("root") || document.body.appendChild(document.createElement("div"));
const mount = ReactDOM.createRoot(root);
mount.render(React.createElement(UserApp));
`;
        const entryFile = new File([entryShim], "entry.tsx", { type: "text/tsx" });
        formData.append("entry.tsx", entryFile);

        const userFile = new File([userSource], "user-code.tsx", { type: "text/tsx" });
        formData.append("user-code.tsx", userFile);

        const init = await buildAuthInit();
        const publishResponse = await capsulesApi.publish(formData, init);

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
          trackEvent("composer_code_publish_failed", { appMode: "code", runner: "webcontainer" });
          return;
        }

        effectiveCapsuleId = publishData.capsuleId;
        setCapsuleId(publishData.capsuleId);
        setCapsuleSource("code");
        setImportStatus("ready");
      }

      const type: VibeType = isAppVibe ? "app" : vibeType;
      const descriptionPayload =
        isLinkVibe
          ? [trimmedDescription, trimmedLink].filter(Boolean).join("\n\n") || undefined
          : trimmedDescription || undefined;
      const tagsForPost = isAppVibe ? selectedTags : [];
      const coverPayload = isImageVibe || isAppVibe ? coverKey ?? undefined : undefined;

      // Create the post
      const init = await buildAuthInit();
      const response = await postsApi.create(
        {
          title: effectiveTitle,
          description: descriptionPayload,
          type,
          capsuleId: effectiveCapsuleId ?? undefined,
          coverKey: coverPayload,
          tags: tagsForPost.length > 0 ? tagsForPost : undefined,
        },
        init
      );

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      if (!response.ok) {
        console.error("Failed to create post:", await response.text());
        setError("Failed to share your vibe. Please try again.");
        trackEvent("composer_submit_failed", { type, appMode });
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
          title: effectiveTitle,
          description: descriptionPayload,
          author: {
            id: user.id,
            handle: user.username || user.id,
            name: user.fullName || null,
            avatarUrl: user.imageUrl || null,
          },
          capsule:
            isAppVibe && effectiveCapsuleId
              ? {
              id: effectiveCapsuleId,
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

      // Show success and reset
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
        hasCapsule: !!effectiveCapsuleId,
        hasDescription: !!descriptionPayload,
      });

      // Reset form
      setTitle("");
      setDescription("");
      setLinkUrl("");
      setSelectedTags([]);
      setTagInput("");
      setCode("");
      setAllowStorage(false);
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
      setVibeType("thought");
      setAppMode("github");
    } catch (err) {
      console.error("Failed to share vibe:", err);
      setError("Failed to share your vibe. Please try again.");
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

  const clearZip = () => {
    setZipFile(null);
    setZipSummary(null);
    setZipManifestWarnings([]);
    setZipPublishWarnings([]);
    setImportError(null);
    if (zipInputRef.current) {
      zipInputRef.current.value = "";
    }
  };

  const resetZipImport = () => {
    setZipFile(null);
    setZipSummary(null);
    setZipManifestWarnings([]);
    setZipPublishWarnings([]);
    if (zipInputRef.current) {
      zipInputRef.current.value = "";
    }
    if (capsuleSource === "zip") {
      setCapsuleId(null);
      setCapsuleSource(null);
      setImportStatus("idle");
      setImportError(null);
    }
  };

  const resetComposer = () => {
    setIsExpanded(false);
    setTitle("");
    setDescription("");
    setLinkUrl("");
    setSelectedTags([]);
    setTagInput("");
    setCode("");
    setAllowStorage(false);
    setEnableParam(false);
    setParamLabel("Intensity");
    setParamDefault(50);
    setParamMin(0);
    setParamMax(100);
    setParamStep(1);
    setError(null);
    setImportError(null);
    setGithubUrl("");
    setCapsuleId(null);
    setCapsuleSource(null);
    setImportStatus("idle");
    setZipFile(null);
    setZipSummary(null);
    setZipManifestWarnings([]);
    setZipPublishWarnings([]);
    setImagePreview(null);
    setCoverKey(null);
    setVibeType("thought");
    setAppMode("github");
    if (zipInputRef.current) {
      zipInputRef.current.value = "";
    }
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

  const isGithubMode = isAppVibe && appMode === "github";
  const isZipMode = isAppVibe && appMode === "zip";
  const isCodeMode = isAppVibe && appMode === "code";
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
    isImporting ||
    isUploadingCover ||
    (isLinkVibe && !linkUrl.trim()) ||
    (!title.trim() && !isLinkVibe) ||
    (isCodeMode && !code.trim()) ||
    (isGithubMode && !hasImportedCapsule && !!githubUrl.trim()) ||
    (isZipMode && !!zipFile && !hasImportedCapsule) ||
    (isAppVibe && requiresCapsuleImport && !hasImportedCapsule) ||
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
            {/* Vibe Type Selector */}
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
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={appMode === "github" ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                  onClick={() => handleAppModeChange("github")}
                >
                  <Github className="h-3 w-3" />
                  GitHub
                </Button>
                <Button
                  type="button"
                  variant={appMode === "zip" ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                  onClick={() => handleAppModeChange("zip")}
                >
                  <Upload className="h-3 w-3" />
                  ZIP
                </Button>
                <Button
                  type="button"
                  variant={appMode === "code" ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                  onClick={() => handleAppModeChange("code")}
                >
                  <Code className="h-3 w-3" />
                  Code
                </Button>
              </div>
            )}

            {/* Main Input */}
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
                disabled={isSubmitting || isImporting}
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
                        disabled={isSubmitting || isImporting}
                      />
                    </div>
                  )}

                  {!isThoughtVibe && (
                    <Textarea
                      placeholder={descriptionPlaceholder}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={isLongformVibe ? 6 : 3}
                      disabled={isSubmitting || isImporting}
                    />
                  )}

                  {isAppVibe && (
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
                                disabled={isSubmitting || isImporting}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {!isTagLimitReached && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            placeholder="e.g. ai, cli, canvas"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={handleTagKeyDown}
                            disabled={isSubmitting || isImporting}
                            className="w-48"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => addTag(tagInput)}
                            disabled={!tagInput.trim() || isSubmitting || isImporting || isTagLimitReached}
                          >
                            Add tag
                          </Button>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {featuredTags.map((tag) => {
                          const active = selectedTags.includes(tag);
                          const atLimit = isTagLimitReached && !active;
                          return (
                            <Button
                              key={tag}
                              type="button"
                              variant={active ? "secondary" : "ghost"}
                              size="sm"
                              className="h-8 px-3"
                              onClick={() => addTag(tag)}
                              disabled={atLimit || isSubmitting || isImporting}
                            >
                              #{tag}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Inline Code Section */}
                  {isCodeMode && (
                    <div className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <Code className="h-4 w-4" />
                        <span className="text-sm font-medium">Inline App Code</span>
                      </div>
                      <Textarea
                        placeholder="Write your app code here. HTML stays client-static; JS/TSX runs in the sandboxed runtime."
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
                          <p className="text-xs text-muted-foreground">
                            Outbound network access is disabled until premium VM tiers launch.
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
                      {!zipFile && (!hasImportedCapsule || capsuleSource !== "zip") && (
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
                      {zipFile && (!hasImportedCapsule || capsuleSource !== "zip") && (
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
                      {importError && isZipMode && (
                        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          <span>{importError}</span>
                        </div>
                      )}
                      {hasImportedCapsule && capsuleSource === "zip" && (
                        <div className="flex items-start gap-2 rounded-md bg-green-500/10 p-2 text-sm text-green-700 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          <span>ZIP imported successfully</span>
                        </div>
                      )}
                      {zipSummary && (
                        <div className="space-y-2 rounded-md border p-3 text-xs">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">{zipSummary.fileName}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatBytes(zipSummary.totalSize)}
                              </p>
                            </div>
                            <Button variant="ghost" size="sm" onClick={resetZipImport}>
                              Replace ZIP
                            </Button>
                          </div>
                          {zipManifestWarnings.length > 0 && (
                            <div className="space-y-1 rounded-md bg-yellow-500/10 p-2 text-yellow-700 dark:text-yellow-400">
                              <p className="text-xs font-medium">Manifest warnings</p>
                              {zipManifestWarnings.slice(0, 4).map((warning, index) => (
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
                    </div>
                  )}

                  {/* Image Upload Section (cover for app or standalone image vibes) */}
                  {(isImageVibe || (isAppVibe && hasImportedCapsule)) && (
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
                              src={imagePreview ?? ""}
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
                <span>{formatErrorMessage(error)}</span>
              </div>
            )}

            {/* Action Buttons */}
            {isExpanded && (
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetComposer}
                  disabled={isSubmitting || isImporting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitDisabled}
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
            )}
          </form>
        </CardContent>
      </Card>
    </motion.section>
  );
}
