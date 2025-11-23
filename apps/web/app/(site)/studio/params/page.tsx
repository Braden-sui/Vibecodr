// Route: /studio/params - Param designer bound to manifest

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { capsulesApi } from "@/lib/api";
import { trackClientError } from "@/lib/analytics";
import { PlayerShell } from "@/components/PlayerShell";
import type { PlayerIframeHandle } from "@/components/Player/PlayerIframe";
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

  const manifestParams = useMemo(() => paramsDraft, [paramsDraft]);

  const handleParamValueChange = (name: string, value: unknown) => {
    setCapsuleParams((prev) => ({ ...prev, [name]: value }));
  };

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
              isRunning
              stats={{ fps: 0, memory: 0, bootTime: 0 }}
              consoleEntries={[]}
              consoleCollapsed
              onConsoleToggle={() => {}}
              onClearConsole={() => {}}
              onRestart={() => playerRef.current?.restart?.()}
              onKill={() => playerRef.current?.kill?.()}
              onShare={() => {}}
              isLoading={false}
              loadError={null}
              onReady={() => {}}
              onLog={() => {}}
              onStats={() => {}}
              onBoot={() => {}}
              onError={(msg) => setError(msg ?? "Preview failed")}
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
