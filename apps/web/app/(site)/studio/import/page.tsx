// Route: /studio/import - Import adapters
// NOTE: Studio screens are currently not linked from navigation; VibesComposer is the active entry point.
// Responsibilities:
// - Accept GitHub repo URL or ZIP
// - Validate, optionally build static bundle, upload to R2 via Worker
// - Surface warnings/files summary from Worker response

"use client";

import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { workerUrl } from "@/lib/api";
import { trackClientError } from "@/lib/analytics";

type ImportState =
  | { status: "idle" }
  | { status: "running"; step: string; progress?: number }
  | { status: "done"; result: ImportResult }
  | { status: "error"; message: string };

type ImportResult = {
  capsuleId: string;
  manifest: { entry: string; title?: string; description?: string };
  filesSummary: { contentHash: string; totalSize: number; fileCount: number; entryPoint: string };
  warnings?: Array<{ path: string; message: string }>;
};

export default function StudioImport() {
  const [githubUrl, setGithubUrl] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [state, setState] = useState<ImportState>({ status: "idle" });
  const navigate = useNavigate();

  const hasInput = useMemo(() => githubUrl.trim().length > 0 || zipFile, [githubUrl, zipFile]);

  const submitImport = useCallback(async () => {
    if (!hasInput) return;
    setState({ status: "running", step: "uploading", progress: 0.05 });

    try {
      let response: Response | null = null;
      const acceptHeaders = { Accept: "application/x-ndjson,application/json" };
      if (zipFile) {
        const form = new FormData();
        form.append("file", zipFile);
        setState({ status: "running", step: "uploading ZIP", progress: 0.2 });
        response = await fetch(workerUrl("/import/zip?progress=1"), {
          method: "POST",
          body: form,
          headers: acceptHeaders,
        });
      } else {
        setState({ status: "running", step: "downloading repo", progress: 0.2 });
        response = await fetch(workerUrl("/import/github?progress=1"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...acceptHeaders },
          body: JSON.stringify({ url: githubUrl }),
        });
      }

      if (!response) {
        throw new Error("No response from import endpoint");
      }

      if (!response.ok) {
        const body = (await safeJson(response)) as { error?: string; reason?: string };
        const message = body?.reason || body?.error || `Import failed (${response.status})`;
        setState({ status: "error", message });
        trackClientError("E-VIBECODR-0701", {
          area: "studio.import",
          status: response.status,
          message,
        });
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/x-ndjson") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalResult: ImportResult | null = null;
        let sawError = false;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line) continue;
            try {
              const event = JSON.parse(line) as
                | { type: "progress"; step: string; progress?: number }
                | { type: "result"; result: ImportResult; status: number }
                | { type: "error"; status: number; body: { error?: string; reason?: string } };
              if (event.type === "progress") {
                setState({ status: "running", step: event.step, progress: event.progress });
              } else if (event.type === "result") {
                finalResult = event.result;
              } else if (event.type === "error") {
                const message = event.body?.reason || event.body?.error || "Import failed";
                setState({ status: "error", message });
                sawError = true;
              }
            } catch (err) {
              console.warn("E-VIBECODR-0701 ndjson parse", err);
            }
          }
        }
        if (finalResult) {
          setState({ status: "done", result: finalResult });
          navigate(`/studio/files?capsuleId=${encodeURIComponent(finalResult.capsuleId)}`);
          return;
        }
        // If we streamed but never saw a result, surface failure.
        if (!sawError) {
          setState({ status: "error", message: "Import did not finish" });
        }
        return;
      }

      const payload = (await response.json()) as ImportResult;
      setState({ status: "done", result: payload });
      navigate(`/studio/files?capsuleId=${encodeURIComponent(payload.capsuleId)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({ status: "error", message });
      trackClientError("E-VIBECODR-0701", { area: "studio.import", message });
    }
  }, [githubUrl, hasInput, zipFile, navigate]);

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold">Import a project</h2>
        <p className="text-sm text-muted-foreground">
          Bring your repo or ZIP; we’ll analyze, build, and stage a draft capsule.
        </p>
      </header>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            GitHub URL
            <input
              type="url"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>

          <div className="text-center text-sm text-muted-foreground">or</div>

          <label className="block text-sm font-medium">
            ZIP file
            <input
              type="file"
              accept=".zip"
              className="mt-1 block w-full text-sm"
              onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
            />
            {zipFile && <p className="mt-1 text-xs text-muted-foreground">{zipFile.name}</p>}
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={!hasInput || state.status === "running"}
            onClick={submitImport}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {state.status === "running" ? "Importing…" : "Start Import"}
          </button>
          {state.status === "running" && (
            <span className="text-xs text-muted-foreground">
              Step: {state.step}
              {state.progress != null ? ` · ${Math.round(state.progress * 100)}%` : ""}
            </span>
          )}
        </div>
      </div>

      {state.status === "done" && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-lg font-semibold">Draft capsule ready</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Capsule ID</dt>
              <dd className="font-mono text-xs">{state.result.capsuleId}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Entry</dt>
              <dd className="font-mono text-xs">{state.result.filesSummary.entryPoint}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Size</dt>
              <dd className="font-mono text-xs">
                {formatBytes(state.result.filesSummary.totalSize)} · {state.result.filesSummary.fileCount} files
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Content hash</dt>
              <dd className="font-mono text-xs break-all">{state.result.filesSummary.contentHash}</dd>
            </div>
          </dl>

          {state.result.warnings && state.result.warnings.length > 0 && (
            <div className="mt-4 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
              <p className="font-semibold">Warnings</p>
              <ul className="mt-2 space-y-1">
                {state.result.warnings.map((w, idx) => (
                  <li key={`${w.path}-${idx}`} className="font-mono text-xs">
                    {w.path}: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {state.status === "error" && (
        <div className="rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-sm text-destructive">
          {state.message}
        </div>
      )}
    </section>
  );
}

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
