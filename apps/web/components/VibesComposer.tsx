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
  Check,
  Minus,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { redirectToSignIn } from "@/lib/client-auth";
import { toast } from "@/lib/toast";
import { postsApi, capsulesApi, coversApi, type FeedPost } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { formatBytes } from "@/lib/zipBundle";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { featuredTags, normalizeTag } from "@/lib/tags";
import { ApiImportResponseSchema, toDraftCapsule } from "@vibecodr/shared";

export interface VibesComposerProps {
  onPostCreated?: (post: FeedPost) => void;
  className?: string;
}

type VibeType = FeedPost["type"];
type AppComposerMode = "github" | "zip" | "code";
type ImportStatus = "idle" | "processing" | "ready" | "error";
type AppProgressStep = "select" | "upload" | "analyze" | "build" | "ready";

type AppAttachment = {
  capsuleId: string;
  source: AppComposerMode;
  title?: string | null;
  warnings?: Array<{ path?: string; message: string } | string>;
  fileName?: string | null;
};

type AppProgressState = {
  status: ImportStatus;
  active: AppProgressStep;
  message?: string | null;
};

const MAX_TAGS = 3;

const PROGRESS_STEPS: Array<{ key: AppProgressStep; label: string; helper?: string }> = [
  { key: "select", label: "Source", helper: "Choose GitHub, ZIP, or inline code" },
  { key: "upload", label: "Upload", helper: "Send files to the builder" },
  { key: "analyze", label: "Analyze", helper: "Inspect manifest + dependencies" },
  { key: "build", label: "Build", helper: "Bundle and prepare capsule" },
  { key: "ready", label: "Ready", helper: "Attach app to your post" },
];

const PROGRESS_ORDER: AppProgressStep[] = PROGRESS_STEPS.map((step) => step.key);

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

const toWarningText = (warning: string | { path?: string; message: string }): string => {
  if (typeof warning === "string") return warning;
  if (warning.path) {
    return `${warning.path}: ${warning.message}`;
  }
  return warning.message;
};

const deriveStepState = (
  step: AppProgressStep,
  progress: AppProgressState,
  isAttached: boolean,
): "done" | "active" | "pending" | "error" => {
  if (isAttached || progress.status === "ready") {
    return "done";
  }
  if (progress.status === "error" && progress.active === step) {
    return "error";
  }
  if (progress.status === "idle") {
    return step === "select" ? "active" : "pending";
  }
  const activeIndex = PROGRESS_ORDER.indexOf(progress.active);
  const stepIndex = PROGRESS_ORDER.indexOf(step);
  if (stepIndex < activeIndex) return "done";
  if (stepIndex === activeIndex) return progress.status === "processing" ? "active" : "pending";
  return "pending";
};

/**
 * VibesComposer - Unified composer for social post types with a bounded app sub-flow.
 * Users pick a vibe type, then (for apps) complete an attach flow with its own progress rail.
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
  const [composerError, setComposerError] = useState<string | null>(null);

  const [appAttachment, setAppAttachment] = useState<AppAttachment | null>(null);
  const [appProgress, setAppProgress] = useState<AppProgressState>({
    status: "idle",
    active: "select",
    message: null,
  });
  const [appError, setAppError] = useState<string | null>(null);

  const [githubUrl, setGithubUrl] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [zipSummary, setZipSummary] = useState<{ fileName: string; totalSize: number } | null>(null);
  const [zipImportWarnings, setZipImportWarnings] = useState<Array<{ path?: string; message: string } | string>>([]);
  const [code, setCode] = useState("");
  const [allowStorage, setAllowStorage] = useState(false);
  const [enableParam, setEnableParam] = useState(false);
  const [paramLabel, setParamLabel] = useState("Intensity");
  const [paramDefault, setParamDefault] = useState(50);
  const [paramMin, setParamMin] = useState(0);
  const [paramMax, setParamMax] = useState(100);
  const [paramStep, setParamStep] = useState(1);

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const prefersReducedMotion = useReducedMotion();
  const isAppVibe = vibeType === "app";
  const isImageVibe = vibeType === "image";
  const isLinkVibe = vibeType === "link";
  const isLongformVibe = vibeType === "longform";
  const isThoughtVibe = vibeType === "thought";
  const isGithubMode = isAppVibe && appMode === "github";
  const isZipMode = isAppVibe && appMode === "zip";
  const isCodeMode = isAppVibe && appMode === "code";
  const isAppBusy = appProgress.status === "processing";
  const hasAttachedApp = Boolean(appAttachment?.capsuleId);

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

  const resetInlineAdvanced = () => {
    setAllowStorage(false);
    setEnableParam(false);
    setParamLabel("Intensity");
    setParamDefault(50);
    setParamMin(0);
    setParamMax(100);
    setParamStep(1);
  };

  const resetAppFlow = () => {
    setAppAttachment(null);
    setAppProgress({ status: "idle", active: "select", message: null });
    setAppError(null);
    setGithubUrl("");
    setZipFile(null);
    setZipSummary(null);
    setZipImportWarnings([]);
    if (zipInputRef.current) {
      zipInputRef.current.value = "";
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
    resetInlineAdvanced();
    setComposerError(null);
    setAppMode("github");
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
      setAppMode("github");
      setGithubUrl(value);
      setIsExpanded(true);
      trackEvent("composer_mode_detected", { type: "app", appMode: "github" });
    }
  };

  const handleVibeTypeChange = (nextType: VibeType) => {
    setVibeType(nextType);
    setComposerError(null);
    setAppError(null);

    if (nextType !== "app") {
      resetAppFlow();
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
    setAppAttachment(null);
    setAppProgress({ status: "idle", active: "select", message: null });
    setAppError(null);

    if (nextMode !== "zip") {
      setZipFile(null);
      setZipSummary(null);
      setZipImportWarnings([]);
      if (zipInputRef.current) {
        zipInputRef.current.value = "";
      }
    }

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

  const handleZipSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".zip")) {
      setComposerError("Please select a ZIP file");
      return;
    }

    setZipFile(file);
    setComposerError(null);
    setAppError(null);
    setZipSummary(null);
    setZipImportWarnings([]);
    setAppProgress({ status: "idle", active: "select", message: null });
  };

  const handleGithubImport = async () => {
    const trimmedUrl = githubUrl.trim();
    if (!trimmedUrl || isAppBusy) return;

    setAppAttachment(null);
    setAppError(null);
    setZipImportWarnings([]);
    setAppProgress({ status: "processing", active: "analyze", message: "Importing repository" });

    try {
      const init = await buildAuthInit();
      const response = await capsulesApi.importGithub({ url: trimmedUrl }, init);

      if (response.status === 401) {
        redirectToSignIn();
        setAppProgress({ status: "idle", active: "select", message: null });
        return;
      }

      const raw = await response.json();
      const parsed = ApiImportResponseSchema.safeParse(raw);

      if (!parsed.success) {
        const message = (raw as any)?.error || "Import failed. Please check the repository URL and try again.";
        setAppError(message);
        setAppProgress({ status: "error", active: "analyze", message });
        trackEvent("composer_github_import_failed", { error: message });
        return;
      }

      const draft = toDraftCapsule(parsed.data);
      setAppAttachment({
        capsuleId: draft.capsuleId,
        source: "github",
        title: draft.manifest?.title ?? trimmedUrl,
        warnings: draft.warnings ?? [],
      });
      if (!title.trim() && draft.manifest?.title) {
        setTitle(draft.manifest.title);
      }
      setAppProgress({ status: "ready", active: "ready", message: "Repository imported" });
      trackEvent("composer_github_import_success", { capsuleId: draft.capsuleId });
    } catch (err) {
      console.error("Failed to import from GitHub:", err);
      setAppError("Import failed. Please try again.");
      setAppProgress({ status: "error", active: "analyze", message: "Import failed" });
      trackEvent("composer_github_import_error");
    }
  };

  const handleZipImport = async () => {
    if (!zipFile || isAppBusy) return;

    setAppAttachment(null);
    setAppError(null);
    setZipImportWarnings([]);
    setAppProgress({ status: "processing", active: "upload", message: "Uploading ZIP" });

    setZipSummary({
      fileName: zipFile.name,
      totalSize: zipFile.size,
    });

    try {
      const init = await buildAuthInit();
      const response = await capsulesApi.importZip(zipFile, init);

      if (response.status === 401) {
        redirectToSignIn();
        setAppProgress({ status: "idle", active: "select", message: null });
        return;
      }

      const raw = await response.json();
      const parsed = ApiImportResponseSchema.safeParse(raw);

      if (!parsed.success) {
        const errorList = Array.isArray((raw as any)?.errors) ? (raw as any).errors : undefined;
        if (errorList?.length) {
          const errorMessages = errorList.map((e: any) => (typeof e === "string" ? e : e.message));
          const message = `Validation failed: ${errorMessages.join(", ")}`;
          setAppError(message);
          setAppProgress({ status: "error", active: "analyze", message });
          trackEvent("composer_zip_import_failed", { error: "server-validation" });
          return;
        }

        const message = (raw as any)?.error || "Upload failed. Please check your ZIP and try again.";
        setAppError(message);
        setAppProgress({ status: "error", active: "upload", message });
        trackEvent("composer_zip_import_failed", { error: message });
        return;
      }

      const draft = toDraftCapsule(parsed.data);

      setZipSummary({
        fileName: zipFile.name,
        totalSize: draft.totalSize,
      });

      setAppAttachment({
        capsuleId: draft.capsuleId,
        source: "zip",
        title: draft.manifest?.title ?? zipFile.name,
        warnings: draft.warnings ?? [],
        fileName: zipFile.name,
      });

      if (!title.trim() && draft.manifest?.title) {
        setTitle(draft.manifest.title);
      }

      setZipImportWarnings(draft.warnings ?? []);
      setAppProgress({ status: "ready", active: "ready", message: "ZIP uploaded" });
      trackEvent("composer_zip_import_success", { capsuleId: draft.capsuleId });
      setZipFile(null);
      if (zipInputRef.current) {
        zipInputRef.current.value = "";
      }
    } catch (err) {
      console.error("Failed to import ZIP:", err);
      setAppError(
        err instanceof Error ? err.message : "Upload failed. Please check your ZIP and try again.",
      );
      setAppProgress({ status: "error", active: "upload", message: "Upload failed" });
      setZipSummary(null);
      setZipImportWarnings([]);
      trackEvent("composer_zip_import_error");
    }
  };

  const buildInlineApp = async () => {
    if (isAppBusy) return;
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setAppError("Add code before building your app.");
      return;
    }

    const manifestTitle = title.trim() || "Inline app";
    setAppAttachment(null);
    setAppError(null);
    setAppProgress({ status: "processing", active: "build", message: "Building inline app" });

    try {
      const capabilities = allowStorage ? ({ storage: true } as { storage?: boolean }) : undefined;

      let params:
        | Array<{
            name: string;
            type: "slider";
            label: string;
            default: number;
            min?: number;
            max?: number;
            step?: number;
          }>
        | undefined;

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
        title: manifestTitle,
        description: description.trim() || undefined,
        ...(capabilities && Object.keys(capabilities).length > 0 ? { capabilities } : {}),
        ...(params && params.length > 0 ? { params } : {}),
      };

      const formData = new FormData();
      const manifestBlob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
      const manifestFile = new File([manifestBlob], "manifest.json", { type: "application/json" });
      formData.append("manifest", manifestFile);

      const hasDefaultExport = /export\s+default\s+/.test(trimmedCode);
      const hasReactImport = /import\s+React/.test(trimmedCode);
      const wrappedSource = hasDefaultExport
        ? trimmedCode
        : `${hasReactImport ? "" : 'import React from "react";\n\n'}export default function App() {\n  return (\n    <>\n${trimmedCode}\n    </>\n  );\n}`;

      const entryShim = `
import React from "react";
import ReactDOM from "react-dom/client";
import UserApp from "./user-code";

const root = document.getElementById("root") || document.body.appendChild(document.createElement("div"));
const mount = ReactDOM.createRoot(root);
mount.render(React.createElement(UserApp));

if (window.vibecodrBridge && typeof window.vibecodrBridge.ready === "function") {
  window.vibecodrBridge.ready({ capabilities: {} });
}
`;
      const entryFile = new File([entryShim], "entry.tsx", { type: "text/tsx" });
      formData.append("entry.tsx", entryFile);

      const userFile = new File([wrappedSource], "user-code.tsx", { type: "text/tsx" });
      formData.append("user-code.tsx", userFile);

      const init = await buildAuthInit();
      const publishResponse = await capsulesApi.publish(formData, init);

      if (publishResponse.status === 401) {
        redirectToSignIn();
        setAppProgress({ status: "idle", active: "select", message: null });
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
        setAppError(message);
        setAppProgress({ status: "error", active: "build", message });
        trackEvent("composer_code_publish_failed", { appMode: "code", runner: "webcontainer" });
        return;
      }

      setAppAttachment({
        capsuleId: publishData.capsuleId,
        source: "code",
        title: manifestTitle,
        warnings: Array.isArray(publishData.warnings) ? (publishData.warnings as any) : [],
      });
      setAppProgress({ status: "ready", active: "ready", message: "Inline app attached" });
      trackEvent("composer_code_publish_success", {
        appMode: "code",
        runner: "webcontainer",
        capsuleId: publishData.capsuleId,
      });
    } catch (err) {
      console.error("Failed to publish inline app:", err);
      setAppError("Failed to publish app. Please check your code and try again.");
      setAppProgress({ status: "error", active: "build", message: "Publish failed" });
      trackEvent("composer_code_publish_error");
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

  const clearZip = () => {
    setZipFile(null);
    setZipSummary(null);
    setZipImportWarnings([]);
    setAppError(null);
    if (zipInputRef.current) {
      zipInputRef.current.value = "";
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

  const progressForDisplay = hasAttachedApp
    ? { status: "ready", active: "ready", message: "App attached" }
    : appProgress;
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
                              Pick a source, let us build, then attach the capsule before posting.
                            </p>
                          </div>
                        </div>
                        {hasAttachedApp && <Badge variant="secondary">App attached</Badge>}
                      </div>

                      <div className="grid gap-2 rounded-md bg-muted/40 p-3">
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                          {PROGRESS_STEPS.map((step) => {
                            const state = deriveStepState(step.key, progressForDisplay, hasAttachedApp);
                            const isError = state === "error";
                            const isDone = state === "done";
                            const isActive = state === "active";
                            const icon = isError ? (
                              <AlertCircle className="h-4 w-4 text-destructive" />
                            ) : isDone ? (
                              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                            ) : isActive ? (
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            ) : (
                              <Minus className="h-4 w-4 text-muted-foreground" />
                            );

                            return (
                              <div
                                key={step.key}
                                className={cn(
                                  "flex items-center gap-2 rounded-md border px-2 py-2",
                                  isError
                                    ? "border-destructive/50 bg-destructive/10"
                                    : isDone
                                      ? "border-green-500/40 bg-green-500/5"
                                      : isActive
                                        ? "border-primary/40 bg-primary/5"
                                        : "border-muted bg-background",
                                )}
                              >
                                {icon}
                                <div className="min-w-0">
                                  <p className="text-xs font-medium leading-tight">{step.label}</p>
                                  <p className="text-[11px] text-muted-foreground leading-tight">{step.helper}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {progressForDisplay.message && (
                          <p className="text-xs text-muted-foreground">{progressForDisplay.message}</p>
                        )}
                      </div>
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
                          <div className="flex items-center gap-2">
                            <Code className="h-4 w-4" />
                            <span className="text-sm font-medium">Inline App Code</span>
                          </div>
                          <Textarea
                            placeholder="Write your app code here. HTML stays client-static; JS/TSX runs in the sandboxed runtime."
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            rows={10}
                            disabled={isSubmitting || isAppBusy}
                          />

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
                                onClick={() => {
                                  setAppAttachment(null);
                                  setAppProgress({ status: "idle", active: "select", message: null });
                                  setAppError(null);
                                }}
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
                                Source: {appAttachment?.source.toUpperCase()} • Capsule ID: {appAttachment?.capsuleId}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setAppAttachment(null);
                                  setAppProgress({ status: "idle", active: "select", message: null });
                                  setAppError(null);
                                }}
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
