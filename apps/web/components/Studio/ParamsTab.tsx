"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Plus, Trash2, GripVertical, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ParamControls } from "@/components/Player/ParamControls";
import { capsulesApi } from "@/lib/api";
import { trackClientError } from "@/lib/analytics";
import { paramSchema, type ManifestParam } from "@vibecodr/shared/manifest";
import type { CapsuleDraft } from "./StudioShell";

interface ParamsTabProps {
  draft?: CapsuleDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<CapsuleDraft | undefined>>;
  buildAuthInit?: () => Promise<RequestInit | undefined>;
}

type ParamIssue = { path: string; message: string };

type CompileInfo = {
  artifactId: string;
  runtimeVersion?: string | null;
  bundleDigest: string;
  bundleSizeBytes: number;
};

/**
 * Params Designer Tab (wired to PATCH /capsules/:id/manifest)
 * - Validates params via @vibecodr/shared paramSchema
 * - Persists changes to manifest
 * - Triggers compile-draft so downstream publish can reuse the artifact
 */
export function ParamsTab({ draft, onDraftChange, buildAuthInit: buildAuthInitProp }: ParamsTabProps) {
  const capsuleId = draft?.capsuleId;
  const manifest = draft?.manifest;
  const { getToken } = useAuth();
  const [params, setParams] = useState<ManifestParam[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [validationIssues, setValidationIssues] = useState<ParamIssue[]>([]);
  const [warnings, setWarnings] = useState<ParamIssue[]>([]);
  const [compileInfo, setCompileInfo] = useState<CompileInfo | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const buildAuthInit = useCallback(async (): Promise<RequestInit | undefined> => {
    if (typeof buildAuthInitProp === "function") {
      return buildAuthInitProp();
    }
    if (typeof getToken !== "function") return undefined;
    const token = await getToken({ template: "workers" });
    if (!token) return undefined;
    return { headers: { Authorization: `Bearer ${token}` } };
  }, [buildAuthInitProp, getToken]);

  useEffect(() => {
    if (manifest?.params) {
      setParams(manifest.params);
      setParamValues(buildDefaultValues(manifest.params));
      setWarnings(draft?.validationWarnings ?? []);
    } else {
      setParams([]);
      setParamValues({});
      setWarnings([]);
    }
  }, [manifest?.params, draft?.validationWarnings]);

  const addParam = () => {
    const baseIndex = params.length + 1;
    const newParam: ManifestParam = {
      name: `param_${baseIndex}`,
      type: "slider",
      label: "New Parameter",
      default: 0,
      min: 0,
      max: 100,
      step: 1,
    };
    setParams([...params, newParam]);
    setParamValues({ ...paramValues, [newParam.name]: newParam.default });
    setEditingIndex(params.length);
  };

  const removeParam = (index: number) => {
    const param = params[index];
    const newParams = params.filter((_, i) => i !== index);
    const nextValues = { ...paramValues };
    delete nextValues[param.name];
    setParams(newParams);
    setParamValues(nextValues);
    setEditingIndex(null);
  };

  const updateParam = (index: number, updates: Partial<ManifestParam>) => {
    const newParams = [...params];
    const oldName = newParams[index].name;
    newParams[index] = sanitizeParam({ ...newParams[index], ...updates });
    const nextValues = { ...paramValues };
    if (updates.name && updates.name !== oldName) {
      nextValues[updates.name] = nextValues[oldName];
      delete nextValues[oldName];
    }
    setParams(newParams);
    setParamValues(nextValues);
  };

  const validateParams = (draftParams: ManifestParam[]) => {
    const parsed = paramSchema.array().safeParse(draftParams);
    if (!parsed.success) {
      const issues = parsed.error.issues.map<ParamIssue>((issue) => ({
        path: issue.path.join(".") || "params",
        message: issue.message,
      }));
      setValidationIssues(issues);
      return null;
    }
    setValidationIssues([]);
    return parsed.data;
  };

  const handleSave = useCallback(async () => {
    if (!capsuleId || !manifest) {
      setError("Import a capsule before editing params.");
      return;
    }
    setIsSaving(true);
    setStatus("Saving params...");
    setError(null);
    setValidationIssues([]);
    setCompileInfo(null);
    try {
      const sanitized = params.map((p) => sanitizeParam(p));
      const parsed = validateParams(sanitized);
      if (!parsed) {
        setStatus(null);
        return;
      }

      const nextManifest = { ...manifest, params: parsed };
      const init = await buildAuthInit();
      const res = await capsulesApi.updateManifest(capsuleId, nextManifest, init);
      if (!res.ok) {
        const body = (await safeJson(res)) as { error?: string };
        throw new Error(body?.error || `Failed to save manifest (${res.status})`);
      }
      const body = (await res.json()) as { warnings?: ParamIssue[] };
      const manifestWarnings = body.warnings ?? [];
      setWarnings(manifestWarnings);

      onDraftChange((prev) =>
        prev
          ? {
              ...prev,
              manifest: nextManifest,
              validationWarnings: manifestWarnings,
              validationErrors: undefined,
              validationStatus: "valid",
              buildStatus: "building",
            }
          : prev
      );

      setStatus("Compiling draft artifact...");
      const compileRes = await capsulesApi.compileDraft(capsuleId, init);
      if (!compileRes.ok) {
        const body = (await safeJson(compileRes)) as { error?: string };
        throw new Error(body?.error || `Compile failed (${compileRes.status})`);
      }
      const compiled = (await compileRes.json()) as CompileInfo;
      setCompileInfo(compiled);
      onDraftChange((prev) =>
        prev
          ? {
              ...prev,
              buildStatus: "success",
              artifact: {
                id: compiled.artifactId,
                runtimeVersion: compiled.runtimeVersion ?? null,
                bundleDigest: compiled.bundleDigest,
                bundleSizeBytes: compiled.bundleSizeBytes ?? null,
                status: "ready",
              },
            }
          : prev
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save params";
      setError(message);
      onDraftChange((prev) =>
        prev
          ? {
              ...prev,
              buildStatus: "failed",
              validationStatus: "invalid",
              validationErrors: [{ path: "params", message }],
            }
          : prev
      );
      trackClientError("E-VIBECODR-0906", { area: "studio.params.save", capsuleId, message });
    } finally {
      setIsSaving(false);
      setStatus(null);
    }
  }, [capsuleId, manifest, params, buildAuthInit, onDraftChange]);

  const manifestParams = useMemo(() => params, [params]);

  if (!capsuleId) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Import first</CardTitle>
            <CardDescription>Import or hydrate a capsule before designing params.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Params are persisted via PATCH /capsules/:id/manifest and validated with the shared schema.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Parameters</h2>
            <p className="text-sm text-muted-foreground">
              Changes patch the manifest and re-run compile-draft for this capsule.
            </p>
          </div>
          <Button onClick={addParam} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Param
          </Button>
        </div>

        <div className="space-y-3">
          {params.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-muted-foreground">No parameters yet</p>
                <Button onClick={addParam} variant="outline" className="mt-4 gap-2">
                  <Plus className="h-4 w-4" />
                  Add Your First Parameter
                </Button>
              </CardContent>
            </Card>
          ) : (
            params.map((param, index) => (
              <Card key={param.name} className={editingIndex === index ? "ring-2 ring-primary" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <CardTitle className="text-base">{param.label}</CardTitle>
                        <CardDescription className="text-xs">
                          {param.name} • {param.type}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditingIndex(editingIndex === index ? null : index)}
                        aria-label="Toggle edit"
                      >
                        {editingIndex === index ? "−" : "⋯"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeParam(index)}
                        aria-label="Delete parameter"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {editingIndex === index && (
                  <CardContent className="space-y-3 border-t pt-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor={`name-${index}`}>Name</Label>
                        <Input
                          id={`name-${index}`}
                          value={param.name}
                          onChange={(e) => updateParam(index, { name: e.target.value })}
                          placeholder="paramName"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`type-${index}`}>Type</Label>
                        <Select
                          value={param.type}
                          onValueChange={(value) =>
                            updateParam(index, { type: value as ManifestParam["type"] })
                          }
                        >
                          <SelectTrigger id={`type-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="slider">Slider</SelectItem>
                            <SelectItem value="toggle">Toggle</SelectItem>
                            <SelectItem value="select">Select</SelectItem>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="color">Color</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`label-${index}`}>Label</Label>
                      <Input
                        id={`label-${index}`}
                        value={param.label}
                        onChange={(e) => updateParam(index, { label: e.target.value })}
                        placeholder="Display label"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`description-${index}`}>Description (optional)</Label>
                      <Input
                        id={`description-${index}`}
                        value={param.description || ""}
                        onChange={(e) => updateParam(index, { description: e.target.value })}
                        placeholder="Brief description"
                      />
                    </div>

                    {(param.type === "slider" || param.type === "number") && (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor={`min-${index}`}>Min</Label>
                          <Input
                            id={`min-${index}`}
                            type="number"
                            value={param.min ?? 0}
                            onChange={(e) => updateParam(index, { min: Number(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`max-${index}`}>Max</Label>
                          <Input
                            id={`max-${index}`}
                            type="number"
                            value={param.max ?? 100}
                            onChange={(e) => updateParam(index, { max: Number(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`step-${index}`}>Step</Label>
                          <Input
                            id={`step-${index}`}
                            type="number"
                            value={param.step ?? 1}
                            onChange={(e) => updateParam(index, { step: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                    )}

                    {param.type === "select" && (
                      <div className="space-y-2">
                        <Label>Options (comma-separated)</Label>
                        <Input
                          value={param.options?.join(", ") || ""}
                          onChange={(e) =>
                            updateParam(index, {
                              options: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Option 1, Option 2, Option 3"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor={`default-${index}`}>Default</Label>
                      <Input
                        id={`default-${index}`}
                        value={String(param.default)}
                        onChange={(e) =>
                          updateParam(index, {
                            default: coerceDefault(e.target.value, param.type),
                          })
                        }
                        placeholder="Default value"
                      />
                    </div>
                  </CardContent>
                )}
              </Card>
            ))
          )}
        </div>

        {status && (
          <div className="flex items-center gap-2 rounded-md border border-muted-foreground/30 bg-muted/40 p-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {status}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {validationIssues.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p className="font-semibold">Fix these before saving:</p>
            <ul className="mt-2 space-y-1 text-xs">
              {validationIssues.map((issue, idx) => (
                <li key={`${issue.path}-${idx}`}>
                  <span className="font-mono">{issue.path}</span>: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-md bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400">
            <p className="font-medium">Manifest warnings</p>
            <ul className="mt-1 space-y-1">
              {warnings.map((warning, index) => (
                <li key={`${warning.path}-${index}`}>
                  <span className="font-mono">{warning.path}</span>: {warning.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {compileInfo && (
          <div className="rounded-md border border-muted-foreground/30 bg-muted/30 p-3 text-sm">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>Params saved and draft compiled.</span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
              <InfoRow label="Artifact ID" value={compileInfo.artifactId} />
              <InfoRow label="Bundle digest" value={compileInfo.bundleDigest} />
              <InfoRow label="Bundle size" value={`${(compileInfo.bundleSizeBytes / 1024).toFixed(1)} KB`} />
              <InfoRow label="Runtime version" value={compileInfo.runtimeVersion ?? "v0.1.0"} />
            </div>
          </div>
        )}
        <Button onClick={handleSave} size="sm" className="w-full gap-2" disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save & Compile"
          )}
        </Button>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold">Live Preview</h2>
          <p className="text-sm text-muted-foreground">
            Test how parameters will appear to users (using ParamControls renderer).
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parameter Controls</CardTitle>
            <CardDescription>
              This is how users will see and interact with your parameters.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ParamControls
              params={manifestParams}
              values={paramValues}
              onChange={(name, value) => {
                setParamValues({ ...paramValues, [name]: value });
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current Values</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(paramValues, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-xs break-all">{value}</p>
    </div>
  );
}

function sanitizeParam(param: ManifestParam): ManifestParam {
  const normalizedName = param.name.replace(/[^a-zA-Z0-9_]/g, "_");
  let defaultValue: ManifestParam["default"] = param.default;
  if (param.type === "slider" || param.type === "number") {
    defaultValue = Number(param.default);
  } else if (param.type === "toggle") {
    defaultValue = Boolean(param.default);
  } else if (param.type === "select" && Array.isArray(param.options) && typeof param.default === "string") {
    defaultValue = param.default;
  } else if (param.type === "color" && typeof param.default === "string") {
    defaultValue = param.default;
  } else if (param.type === "text" && typeof param.default === "string") {
    defaultValue = param.default;
  }
  return { ...param, name: normalizedName, default: defaultValue };
}

function coerceDefault(value: string, type: ManifestParam["type"]): ManifestParam["default"] {
  if (type === "slider" || type === "number") {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }
  if (type === "toggle") {
    return value === "true" || value === "1";
  }
  return value;
}

function buildDefaultValues(params: ManifestParam[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const p of params) {
    values[p.name] = p.default;
  }
  return values;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
