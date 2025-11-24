// Route: /studio/params - Param designer bound to manifest

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { capsulesApi } from "@/lib/api";
import { trackClientError } from "@/lib/analytics";
import { PlayerShell } from "@/components/PlayerShell";
import type { PlayerIframeHandle } from "@/components/Player/PlayerIframe";
import {
  confirmRuntimeSlot,
  getRuntimeBudgets,
  releaseRuntimeSlot,
  reserveRuntimeSlot,
} from "@/components/Player/runtimeBudgets";
import { toast } from "@/lib/toast";
import type { Manifest } from "@vibecodr/shared/manifest";

type SummaryResponse = {
  capsuleId: string;
  contentHash: string;
  manifest: { entry: string; runner?: string; artifactId?: string | null; params?: any };
};

type ParamDraft = {
  name: string;
  type: "slider" | "toggle" | "select" | "text" | "color" | "number";
  label: string;
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
};

type RuntimeBudgetReason = "boot_timeout" | "run_timeout" | "concurrency_limit";

const RUNTIME_BUDGETS = getRuntimeBudgets();
const CLIENT_STATIC_BOOT_BUDGET_MS = RUNTIME_BUDGETS.clientStaticBootMs;
const RUN_SESSION_BUDGET_MS = RUNTIME_BUDGETS.runSessionMs;
const MAX_CONCURRENT_RUNNERS = RUNTIME_BUDGETS.maxConcurrentRunners;

function isClientStaticRunnerType(runner?: string | null): boolean {
  if (!runner) return true;
  const normalized = runner.toLowerCase();
  return normalized === "client-static" || normalized === "html";
}

export default function StudioParams() {
  const [search] = useSearchParams();
  const capsuleId = search.get("capsuleId") || "";
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [paramsDraft, setParamsDraft] = useState<ParamDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capsuleParams, setCapsuleParams] = useState<Record<string, unknown>>({});
  const [previewKey, setPreviewKey] = useState(0);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const playerRef = useRef<PlayerIframeHandle | null>(null);
  const [isPreviewRunning, setIsPreviewRunning] = useState(false);
  const runtimeSlotRef = useRef<symbol | string | null>(null);
  const bootTimerRef = useRef<number | null>(null);
  const runTimerRef = useRef<number | null>(null);
  const budgetStateRef = useRef<{ bootStartedAt: number | null; runStartedAt: number | null; budgetViolated: boolean }>({
    bootStartedAt: null,
    runStartedAt: null,
    budgetViolated: false,
  });
  const previewRunIdRef = useRef<string | null>(null);

  const loadSummary = useCallback(async () => {
    if (!capsuleId) return;
    setStatus("Loading manifest…");
    try {
      const res = await capsulesApi.filesSummary(capsuleId);
      if (!res.ok) {
        const body = (await safeJson(res)) as { error?: string };
        throw new Error(body?.error || `Failed to load manifest (${res.status})`);
      }
      const data = (await res.json()) as SummaryResponse;
      setSummary(data);
      const parsedParams = normalizeParams(data.manifest.params);
      setParamsDraft(parsedParams);
      setCapsuleParams(buildDefaultValues(parsedParams));
      setStatus(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus(null);
    }
  }, [capsuleId]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    return () => {
      clearPreviewTimers();
      releasePreviewSlot();
    };
  }, [clearPreviewTimers, releasePreviewSlot]);

  useEffect(() => {
    setIsPreviewRunning(false);
    resetPreviewBudgetState();
    clearPreviewTimers();
    releasePreviewSlot();
  }, [capsuleId, clearPreviewTimers, releasePreviewSlot, resetPreviewBudgetState]);

  const onAddParam = () => {
    setParamsDraft((prev) => [
      ...prev,
      {
        name: `param_${prev.length + 1}`,
        type: "text",
        label: "New param",
        default: "",
      },
    ]);
  };

  const onParamChange = (index: number, key: keyof ParamDraft, value: any) => {
    setParamsDraft((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  const onSave = useCallback(async () => {
    if (!summary) return;
    setIsSaving(true);
    setStatus("Saving manifest…");
    setError(null);
    try {
      const runner: Manifest["runner"] =
        summary.manifest.runner === "webcontainer" ? "webcontainer" : "client-static";
      const nextManifest: Manifest = {
        ...summary.manifest,
        version: "1.0",
        runner,
        params: paramsDraft,
      };
      const res = await capsulesApi.updateManifest(summary.capsuleId, nextManifest);
      if (!res.ok) {
        const body = (await safeJson(res)) as { error?: string };
        throw new Error(body?.error || `Failed to save manifest (${res.status})`);
      }
      const compile = await capsulesApi.compileDraft(summary.capsuleId);
      if (!compile.ok) {
        const body = (await safeJson(compile)) as { error?: string };
        throw new Error(body?.error || `Failed to compile draft (${compile.status})`);
      }
      const compiled = (await compile.json()) as { artifactId: string };
      setArtifactId(compiled.artifactId);
      setPreviewKey((k) => k + 1);
      setCapsuleParams(buildDefaultValues(paramsDraft));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      trackClientError("E-VIBECODR-0703", { area: "studio.params.save", capsuleId, message });
    } finally {
      setIsSaving(false);
      setStatus(null);
    }
  }, [summary, paramsDraft, capsuleId]);

  const clearPreviewTimers = useCallback(() => {
    if (bootTimerRef.current) {
      clearTimeout(bootTimerRef.current);
      bootTimerRef.current = null;
    }
    if (runTimerRef.current) {
      clearTimeout(runTimerRef.current);
      runTimerRef.current = null;
    }
  }, []);

  const releasePreviewSlot = useCallback(() => {
    if (runtimeSlotRef.current) {
      releaseRuntimeSlot(runtimeSlotRef.current);
      runtimeSlotRef.current = null;
    }
  }, []);

  const resetPreviewBudgetState = useCallback(() => {
    budgetStateRef.current = { bootStartedAt: null, runStartedAt: null, budgetViolated: false };
    previewRunIdRef.current = null;
  }, []);

  const manifestParams = useMemo(() => paramsDraft, [paramsDraft]);

  const handleParamValueChange = (name: string, value: unknown) => {
    setCapsuleParams((prev) => ({ ...prev, [name]: value }));
  };

  const handlePreviewBudgetViolation = useCallback(
    (reason: RuntimeBudgetReason, context?: { activeCount?: number }) => {
      if (budgetStateRef.current.budgetViolated) {
        return;
      }
      budgetStateRef.current.budgetViolated = true;
      clearPreviewTimers();
      releasePreviewSlot();
      const friendly =
        reason === "concurrency_limit"
          ? `Only ${MAX_CONCURRENT_RUNNERS} preview${MAX_CONCURRENT_RUNNERS === 1 ? "" : "s"} can run at once. Stop one before starting another.`
          : reason === "boot_timeout"
          ? "Preview took too long to start, so we stopped it to keep the Studio responsive."
          : `Preview runs stop after ${Math.round(RUN_SESSION_BUDGET_MS / 1000)}s.`;

      toast({
        title: "Preview stopped",
        description: friendly,
        variant: "warning",
      });

      playerRef.current?.kill?.();
      setIsPreviewRunning(false);
      resetPreviewBudgetState();
    },
    [clearPreviewTimers, releasePreviewSlot, resetPreviewBudgetState]
  );

  const handlePreviewLoading = useCallback(() => {
    const runner = summary?.manifest.runner ?? null;
    if (!runtimeSlotRef.current) {
      const reservation = reserveRuntimeSlot();
      runtimeSlotRef.current = reservation.allowed ? reservation.token : null;
      if (!reservation.allowed) {
        handlePreviewBudgetViolation("concurrency_limit", { activeCount: reservation.activeCount });
        return;
      }
    }
    budgetStateRef.current = { bootStartedAt: Date.now(), runStartedAt: null, budgetViolated: false };
    clearPreviewTimers();
    if (isClientStaticRunnerType(runner)) {
      bootTimerRef.current = window.setTimeout(() => {
        handlePreviewBudgetViolation("boot_timeout");
      }, CLIENT_STATIC_BOOT_BUDGET_MS);
    }
    setIsPreviewRunning(true);
  }, [clearPreviewTimers, handlePreviewBudgetViolation, summary?.manifest.runner]);

  const handlePreviewReady = useCallback(() => {
    clearPreviewTimers();
    const runId = previewRunIdRef.current ?? createStableId("preview-run");
    const confirmation = confirmRuntimeSlot(runtimeSlotRef.current ?? runId, runId);
    if (!confirmation.allowed) {
      handlePreviewBudgetViolation("concurrency_limit", { activeCount: confirmation.activeCount });
      return;
    }
    runtimeSlotRef.current = runId;
    previewRunIdRef.current = runId;
    budgetStateRef.current.runStartedAt = Date.now();
    runTimerRef.current = window.setTimeout(() => {
      handlePreviewBudgetViolation("run_timeout");
    }, RUN_SESSION_BUDGET_MS);
  }, [clearPreviewTimers, handlePreviewBudgetViolation]);

  const handlePreviewError = useCallback(
    (message?: string) => {
      clearPreviewTimers();
      releasePreviewSlot();
      setIsPreviewRunning(false);
      resetPreviewBudgetState();
      setError(message ?? "Preview failed");
    },
    [clearPreviewTimers, releasePreviewSlot, resetPreviewBudgetState]
  );

  const handlePreviewKill = useCallback(() => {
    clearPreviewTimers();
    releasePreviewSlot();
    resetPreviewBudgetState();
    setIsPreviewRunning(false);
  }, [clearPreviewTimers, releasePreviewSlot, resetPreviewBudgetState]);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Params</h2>
          <p className="text-sm text-muted-foreground">Define controls and live-preview your draft capsule.</p>
        </div>
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {status && <p className="text-xs text-muted-foreground">{status}</p>}

      <div className="grid grid-cols-[320px_1fr] gap-4">
        <div className="rounded border bg-card p-3 text-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-semibold">Controls</p>
            <button
              className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
              onClick={onAddParam}
            >
              Add
            </button>
          </div>
          <div className="space-y-3">
            {manifestParams.map((param, idx) => (
              <div key={param.name} className="rounded border p-2">
                <input
                  className="mb-1 w-full rounded border px-2 py-1 text-xs"
                  value={param.name}
                  onChange={(e) => onParamChange(idx, "name", e.target.value)}
                  placeholder="name"
                />
                <input
                  className="mb-1 w-full rounded border px-2 py-1 text-xs"
                  value={param.label}
                  onChange={(e) => onParamChange(idx, "label", e.target.value)}
                  placeholder="label"
                />
                <select
                  className="mb-1 w-full rounded border px-2 py-1 text-xs"
                  value={param.type}
                  onChange={(e) => onParamChange(idx, "type", e.target.value as ParamDraft["type"])}
                >
                  <option value="text">text</option>
                  <option value="slider">slider</option>
                  <option value="number">number</option>
                  <option value="toggle">toggle</option>
                  <option value="select">select</option>
                </select>
                <input
                  className="mb-1 w-full rounded border px-2 py-1 text-xs"
                  value={String(param.default)}
                  onChange={(e) => onParamChange(idx, "default", coerceDefault(e.target.value, param.type))}
                  placeholder="default"
                />
              </div>
            ))}
          </div>
          <button
            className="mt-3 w-full rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            onClick={onSave}
            disabled={isSaving || !summary}
          >
            {isSaving ? "Saving…" : "Save params"}
          </button>
        </div>

        <div className="rounded border bg-card p-3">
          <p className="mb-2 text-sm font-semibold">Preview</p>
          {summary ? (
            <PlayerShell
              key={previewKey}
              capsuleId={summary.capsuleId}
              artifactId={artifactId ?? summary.manifest.artifactId ?? undefined}
              params={capsuleParams}
              postId={summary.capsuleId}
              isRunning={isPreviewRunning}
              stats={{ fps: 0, memory: 0, bootTime: 0 }}
              consoleEntries={[]}
              consoleCollapsed
              onConsoleToggle={() => {}}
              onClearConsole={() => {}}
              onRestart={() => {
                handlePreviewKill();
                playerRef.current?.restart?.();
              }}
              onKill={() => {
                handlePreviewKill();
                playerRef.current?.kill?.();
              }}
              onShare={() => {}}
              isLoading={false}
              loadError={null}
              onReady={handlePreviewReady}
              onLoading={handlePreviewLoading}
              onLog={() => {}}
              onStats={() => {}}
              onBoot={() => {}}
              onError={handlePreviewError}
              ref={playerRef}
            />
          ) : (
            <div className="h-80 rounded border bg-muted" />
          )}
        </div>
      </div>
    </section>
  );
}

function createStableId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeParams(params: any): ParamDraft[] {
  if (!Array.isArray(params)) return [];
  return params.map((p) => ({
    name: String(p.name ?? ""),
    type: (p.type as ParamDraft["type"]) || "text",
    label: String(p.label ?? p.name ?? "Param"),
    default: p.default ?? "",
    min: p.min,
    max: p.max,
    step: p.step,
    options: Array.isArray(p.options) ? p.options : undefined,
  }));
}

function buildDefaultValues(params: ParamDraft[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const p of params) {
    values[p.name] = p.default;
  }
  return values;
}

function coerceDefault(value: string, type: ParamDraft["type"]): any {
  if (type === "slider" || type === "number") {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }
  if (type === "toggle") {
    return value === "true";
  }
  return value;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

type ManifestDraft = Manifest;
