// Route: /studio/files - Minimal editor wired to Worker APIs

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { capsulesApi } from "@/lib/api";
import { trackClientError } from "@/lib/analytics";

type FileSummary = { path: string; size: number; hash?: string };
type SummaryResponse = {
  capsuleId: string;
  contentHash: string;
  manifest: { entry: string; params?: any };
  files: FileSummary[];
  totalSize: number;
  fileCount: number;
};

export default function StudioFiles() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const capsuleId = search.get("capsuleId") || "";
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    if (!capsuleId) return;
    setStatus("Loading files…");
    try {
      const res = await capsulesApi.filesSummary(capsuleId);
      if (!res.ok) {
        const body = (await safeJson(res)) as { error?: string };
        throw new Error(body?.error || `Failed to load summary (${res.status})`);
      }
      const data = (await res.json()) as SummaryResponse;
      setSummary(data);
      setSelectedPath(data.manifest.entry || data.files[0]?.path || null);
      setStatus(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus(null);
    }
  }, [capsuleId]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const loadFile = useCallback(
    async (path: string) => {
      if (!capsuleId) return;
      setStatus(`Loading ${path}…`);
      setError(null);
      try {
        const res = await capsulesApi.getFile(capsuleId, path);
        if (!res.ok) {
          const body = (await safeJson(res)) as { error?: string };
          throw new Error(body?.error || `Failed to load file (${res.status})`);
        }
        const text = await res.text();
        setContent(text);
        setSelectedPath(path);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setStatus(null);
      }
    },
    [capsuleId]
  );

  useEffect(() => {
    if (selectedPath && summary) {
      void loadFile(selectedPath);
    }
  }, [selectedPath, summary, loadFile]);

  const onSave = useCallback(async () => {
    if (!capsuleId || !summary || !selectedPath) return;
    setIsSaving(true);
    setStatus("Saving…");
    setError(null);
    try {
      if (selectedPath === "manifest.json") {
        const parsed = JSON.parse(content) as ManifestDraft;
        const res = await capsulesApi.updateManifest(capsuleId, parsed);
        if (!res.ok) {
          const body = (await safeJson(res)) as { error?: string };
          throw new Error(body?.error || `Failed to save manifest (${res.status})`);
        }
      } else {
        const res = await capsulesApi.putFile(capsuleId, selectedPath, content, "text/plain");
        if (!res.ok) {
          const body = (await safeJson(res)) as { error?: string };
          throw new Error(body?.error || `Failed to save file (${res.status})`);
        }
      }
      await fetchSummary();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      trackClientError("E-VIBECODR-0702", { area: "studio.files.save", capsuleId, path: selectedPath, message });
    } finally {
      setIsSaving(false);
      setStatus(null);
    }
  }, [capsuleId, summary, selectedPath, content, fetchSummary]);

  const manifestPaths = useMemo(() => ["manifest.json"], []);

  if (!capsuleId) {
    return (
      <section className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-muted-foreground">Provide a capsuleId query param to edit files.</p>
      </section>
    );
  }

  const files = summary?.files ?? [];
  const allPaths = useMemo(() => {
    const set = new Set<string>();
    manifestPaths.forEach((p) => set.add(p));
    files.forEach((f) => set.add(f.path));
    return Array.from(set);
  }, [files, manifestPaths]);

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Files</h2>
          <p className="text-sm text-muted-foreground">Edit draft files and manifest for capsule {capsuleId}.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            onClick={() => navigate(`/studio/params?capsuleId=${encodeURIComponent(capsuleId)}`)}
          >
            Edit Params
          </button>
          <button
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            onClick={async () => {
              if (!capsuleId) return;
              setPublishStatus("Publishing…");
              setPublishError(null);
              try {
                const res = await capsulesApi.publishDraft(capsuleId);
                if (!res.ok) {
                  const body = (await safeJson(res)) as { error?: string };
                  throw new Error(body?.error || `Publish failed (${res.status})`);
                }
                const data = (await res.json()) as { postId?: string };
                setPublishStatus("Published");
                if (data.postId) {
                  navigate(`/player/${data.postId}`);
                }
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setPublishError(message);
              } finally {
                setTimeout(() => setPublishStatus(null), 1200);
              }
            }}
          >
            Publish
          </button>
          {publishStatus && <span className="text-xs text-muted-foreground">{publishStatus}</span>}
          {publishError && <span className="text-xs text-destructive">{publishError}</span>}
        </div>
      </header>

      <div className="grid grid-cols-[240px_1fr] gap-4">
        <aside className="rounded border bg-card p-3 text-sm">
          <p className="mb-2 font-semibold">Files</p>
          <ul className="space-y-1">
            {allPaths.map((path) => (
              <li key={path}>
                <button
                  className={`w-full rounded px-2 py-1 text-left hover:bg-muted ${selectedPath === path ? "bg-muted" : ""}`}
                  onClick={() => setSelectedPath(path)}
                >
                  {path}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="rounded border bg-card p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-mono text-xs text-muted-foreground">{selectedPath || "Select a file"}</span>
            <div className="flex items-center gap-2">
              {status && <span className="text-xs text-muted-foreground">{status}</span>}
              <button
                className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-60"
                disabled={!selectedPath || isSaving}
                onClick={onSave}
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="h-[480px] w-full rounded border px-3 py-2 font-mono text-xs"
            spellCheck={false}
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          {summary && (
            <p className="mt-2 text-xs text-muted-foreground">
              Bundle: {formatBytes(summary.totalSize)} · {summary.fileCount} files
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

type ManifestDraft = ManifestShape;
type ManifestShape = {
  version?: string;
  runner?: string;
  entry?: string;
  params?: unknown;
  capabilities?: unknown;
  [key: string]: unknown;
};

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}
