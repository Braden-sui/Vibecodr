'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { ApiImportResponseSchema, toDraftCapsule } from "@vibecodr/shared";
import { capsulesApi } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";

export type AppComposerMode = "github" | "zip" | "code";
export type ImportStatus = "idle" | "processing" | "ready" | "error";
export type AppProgressStep = "select" | "upload" | "analyze" | "build" | "ready";

export type AppAttachment = {
  capsuleId: string;
  source: AppComposerMode;
  title?: string | null;
  warnings?: Array<{ path?: string; message: string } | string>;
  fileName?: string | null;
};

export type AppProgressState = {
  status: ImportStatus;
  active: AppProgressStep;
  message?: string | null;
};

type UseAppImportOptions = {
  buildAuthInit: () => Promise<RequestInit | undefined>;
  onRequireAuth: () => void;
  onTitleSuggestion?: (title: string) => void;
  getTitle: () => string;
  getDescription: () => string;
  onComposerError?: (message: string) => void;
  onClearComposerError?: () => void;
};

export function useAppImport({
  buildAuthInit,
  onRequireAuth,
  onTitleSuggestion,
  getTitle,
  getDescription,
  onComposerError,
  onClearComposerError,
}: UseAppImportOptions) {
  const [appMode, setAppMode] = useState<AppComposerMode>("github");
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

  const [debouncedCode, setDebouncedCode] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  const zipInputRef = useRef<HTMLInputElement>(null);
  const isAppBusy = appProgress.status === "processing";
  const hasAttachedApp = Boolean(appAttachment?.capsuleId);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCode(code);
      setPreviewError(null);
    }, 300);

    return () => clearTimeout(timer);
  }, [code]);

  const handlePreviewReady = useCallback(() => {
    setPreviewError(null);
  }, []);

  const handlePreviewError = useCallback((message: string) => {
    setPreviewError(message);
  }, []);

  const resetInlineAdvanced = useCallback(() => {
    setAllowStorage(false);
    setEnableParam(false);
    setParamLabel("Intensity");
    setParamDefault(50);
    setParamMin(0);
    setParamMax(100);
    setParamStep(1);
  }, []);

  const resetAppFlow = useCallback(() => {
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
  }, []);

  const handleAppModeChange = useCallback(
    (nextMode: AppComposerMode) => {
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
    },
    [],
  );

  const handleZipSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.name.endsWith(".zip")) {
        onComposerError?.("Please select a ZIP file");
        return;
      }

      onClearComposerError?.();
      setZipFile(file);
      setAppError(null);
      setZipSummary(null);
      setZipImportWarnings([]);
      setAppProgress({ status: "idle", active: "select", message: null });
    },
    [onClearComposerError, onComposerError],
  );

  const handleGithubImport = useCallback(async () => {
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
        onRequireAuth();
        setAppProgress({ status: "idle", active: "select", message: null });
        return;
      }

      const raw = await response.json();
      const parsed = ApiImportResponseSchema.safeParse(raw);

      if (!parsed.success) {
        const rawMessage = (raw as { error?: unknown })?.error;
        const message =
          typeof rawMessage === "string"
            ? rawMessage
            : "Import failed. Please check the repository URL and try again.";
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
      const currentTitle = getTitle().trim();
      if (!currentTitle && draft.manifest?.title) {
        onTitleSuggestion?.(draft.manifest.title);
      }
      setAppProgress({ status: "ready", active: "ready", message: "Repository imported" });
      trackEvent("composer_github_import_success", { capsuleId: draft.capsuleId });
    } catch (err) {
      console.error("Failed to import from GitHub:", err);
      setAppError("Import failed. Please try again.");
      setAppProgress({ status: "error", active: "analyze", message: "Import failed" });
      trackEvent("composer_github_import_error");
    }
  }, [buildAuthInit, getTitle, githubUrl, isAppBusy, onRequireAuth, onTitleSuggestion]);

  const handleZipImport = useCallback(async () => {
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
        onRequireAuth();
        setAppProgress({ status: "idle", active: "select", message: null });
        return;
      }

      const raw = await response.json();
      const parsed = ApiImportResponseSchema.safeParse(raw);

      if (!parsed.success) {
        const rawErrors = Array.isArray((raw as { errors?: unknown })?.errors)
          ? ((raw as { errors?: unknown }).errors as unknown[])
          : undefined;
        if (rawErrors?.length) {
          const errorMessages = rawErrors.map((entry) => {
            if (typeof entry === "string") return entry;
            if (entry && typeof entry === "object" && "message" in entry) {
              const messageValue = (entry as { message?: unknown }).message;
              return typeof messageValue === "string" ? messageValue : "Unknown validation error";
            }
            return "Unknown validation error";
          });
          const message = `Validation failed: ${errorMessages.join(", ")}`;
          setAppError(message);
          setAppProgress({ status: "error", active: "analyze", message });
          trackEvent("composer_zip_import_failed", { error: "server-validation" });
          return;
        }

        const rawMessage = (raw as { error?: unknown })?.error;
        const message =
          typeof rawMessage === "string" ? rawMessage : "Upload failed. Please check your ZIP and try again.";
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

      const currentTitle = getTitle().trim();
      if (!currentTitle && draft.manifest?.title) {
        onTitleSuggestion?.(draft.manifest.title);
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
      setAppError(err instanceof Error ? err.message : "Upload failed. Please check your ZIP and try again.");
      setAppProgress({ status: "error", active: "upload", message: "Upload failed" });
      setZipSummary(null);
      setZipImportWarnings([]);
      trackEvent("composer_zip_import_error");
    }
  }, [buildAuthInit, getTitle, isAppBusy, onRequireAuth, onTitleSuggestion, zipFile]);

  const buildInlineApp = useCallback(async () => {
    if (isAppBusy) return;
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setAppError("Add code before building your app.");
      return;
    }

    const manifestTitle = getTitle().trim() || "Inline app";
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
        description: getDescription().trim() || undefined,
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
        onRequireAuth();
        setAppProgress({ status: "idle", active: "select", message: null });
        return;
      }

      const publishData = (await publishResponse.json()) as {
        success?: boolean;
        capsuleId?: string;
        error?: string;
        details?: string;
        warnings?: unknown;
      };

      if (!publishResponse.ok || !publishData.success || !publishData.capsuleId) {
        const baseMessage = publishData.error || "Failed to publish app. Please check your code and try again.";
        const detailSuffix = publishData.details ? `: ${publishData.details}` : "";
        const message = `${baseMessage}${detailSuffix}`;
        console.error("Inline code publish failed:", message);
        setAppError(message);
        setAppProgress({ status: "error", active: "build", message: baseMessage });
        trackEvent("composer_code_publish_failed", { appMode: "code", runner: "webcontainer" });
        return;
      }

      setAppAttachment({
        capsuleId: publishData.capsuleId,
        source: "code",
        title: manifestTitle,
        warnings: Array.isArray(publishData.warnings)
          ? publishData.warnings.map((warning): { path?: string; message: string } | string => {
              if (typeof warning === "string") return warning;
              if (warning && typeof warning === "object" && "message" in warning) {
                const messageValue = (warning as { message?: unknown }).message;
                return {
                  ...(warning as { path?: string }),
                  message: typeof messageValue === "string" ? messageValue : "Build warning",
                };
              }
              return "Build warning";
            })
          : [],
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
  }, [
    allowStorage,
    buildAuthInit,
    code,
    enableParam,
    getDescription,
    getTitle,
    isAppBusy,
    onRequireAuth,
    paramDefault,
    paramLabel,
    paramMax,
    paramMin,
    paramStep,
  ]);

  const clearZip = useCallback(() => {
    setZipFile(null);
    setZipSummary(null);
    setZipImportWarnings([]);
    setAppError(null);
    if (zipInputRef.current) {
      zipInputRef.current.value = "";
    }
  }, []);

  const clearAttachment = useCallback(() => {
    setAppAttachment(null);
    setAppProgress({ status: "idle", active: "select", message: null });
    setAppError(null);
  }, []);

  return {
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
  };
}
