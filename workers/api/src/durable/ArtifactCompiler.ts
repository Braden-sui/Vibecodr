import type { Env } from "../types";
import { json } from "../lib/responses";
import type { Manifest } from "@vibecodr/shared/manifest";
import {
  ERROR_ARTIFACT_COMPILER_STATE_WRITE_FAILED,
  ERROR_ARTIFACT_COMPILER_ANALYTICS_FAILED,
  ERROR_INSPECTOR_COMPILE_STATE_FAILED,
} from "@vibecodr/shared";
import { compileReactArtifact } from "../runtime/compileReactArtifact";
import { compileHtmlArtifact } from "../runtime/compileHtmlArtifact";
import {
  buildRuntimeManifest,
  RUNTIME_ARTIFACT_TYPES,
  type RuntimeArtifactType,
} from "../runtime/runtimeManifest";
import {
  downloadCapsuleFile,
  generateContentHash,
  listCapsuleFiles,
} from "../storage/r2";
import { requireCapsuleManifest } from "../capsule-manifest";
import { recordBundleWarningMetrics } from "../runtime/bundleTelemetry";
import type { PublishWarning } from "../handlers/capsules";

type ArtifactCompilerEnv = Pick<
  Env,
  "DB" | "R2" | "RUNTIME_MANIFEST_KV" | "vibecodr_analytics_engine"
>;

type ArtifactRow = {
  id: string;
  capsule_id: string;
  type: string;
  runtime_version?: string | null;
  bundle_digest: string;
  status?: string | null;
  policy_status?: string | null;
  visibility?: string | null;
  capsule_manifest_json: string;
  capsule_hash: string;
};

type ManifestVersionRow = { max_version?: number | null };

const DEFAULT_RUNTIME_VERSION = "v0.1.0";
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const TEXT_EXTENSIONS = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "css",
  "txt",
  "md",
  "html",
  "htm",
]);

class ArtifactCompileError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(body?.error ? String(body.error) : "artifact_compile_error");
    this.status = status;
    this.body = body;
  }
}

export class ArtifactCompiler {
  private state: DurableObjectState;
  private env: ArtifactCompilerEnv;

  constructor(state: DurableObjectState, env: ArtifactCompilerEnv) {
    this.state = state;
    this.env = env;
  }

  private writeCompileAnalytics(payload: {
    outcome: "success" | "error";
    artifactId: string;
    runtimeType?: string;
    bundleSizeBytes?: number;
    elapsedMs?: number;
    warnings?: number;
    errorCode?: string;
  }) {
    try {
      const analytics = this.env.vibecodr_analytics_engine;
      if (!analytics || typeof analytics.writeDataPoint !== "function") return;
      analytics.writeDataPoint({
        blobs: [
          "artifact_compile",
          payload.outcome,
          payload.runtimeType ?? "",
          payload.errorCode ?? "",
          payload.artifactId,
        ],
        doubles: [payload.bundleSizeBytes ?? 0, payload.elapsedMs ?? 0, payload.warnings ?? 0],
        indexes: [payload.artifactId],
      });
    } catch (err) {
      console.error("E-VIBECODR-1204 compile analytics failed", {
        artifactId: payload.artifactId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname.endsWith("/inspect")) {
      try {
        const [lastCompileRequest, lastCompileResult] = await Promise.all([
          this.state.storage.get("lastCompileRequest"),
          this.state.storage.get("lastCompileResult"),
        ]);

        return json({
          ok: true,
          lastCompileRequest: lastCompileRequest || null,
          lastCompileResult: lastCompileResult || null,
        });
      } catch (error) {
        console.error(`${ERROR_INSPECTOR_COMPILE_STATE_FAILED} ArtifactCompiler inspect read failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return json(
          {
            ok: false,
            error: "compile_state_unavailable",
            code: ERROR_INSPECTOR_COMPILE_STATE_FAILED,
          },
          500
        );
      }
    }

    if (req.method === "POST" && url.pathname.endsWith("/compile")) {
      const parsed = await this.parseBody(req);
      if (!parsed.ok) {
        return json(parsed.body, parsed.status);
      }

      const { artifactId, type } = parsed;
      await this.recordLastCompileRequest(artifactId, type);
      this.writeAnalytics("artifact_compile_queued", [1]);

      try {
        const result = await this.compileArtifact(artifactId);
        await this.recordLastCompileResult(artifactId, "success", {
          bundleKey: result.bundleKey,
          runtimeType: result.runtimeType,
          bundleSize: result.bundleSizeBytes,
          warnings: result.warnings,
        });

        return json(
          {
            ok: true,
            compiled: true,
            artifactId,
            warnings: result.warnings,
            bundleKey: result.bundleKey,
            runtimeManifestKey: result.runtimeManifestKey,
          },
          202
        );
      } catch (error) {
        if (error instanceof ArtifactCompileError) {
          await this.recordLastCompileResult(artifactId, "error", error.body);
          this.writeAnalytics("artifact_compile_failed", [1]);
          return json({ ok: false, ...error.body }, error.status);
        }

        console.error("E-VIBECODR-1108 artifact compile failed", {
          artifactId,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.recordLastCompileResult(artifactId, "error", {
          error: "artifact_compile_failed",
        });
        this.writeAnalytics("artifact_compile_failed", [1]);
        return json({ ok: false, error: "artifact_compile_failed" }, 500);
      }
    }

    return json({ ok: false, error: "Not found" }, 404);
  }

  private async parseBody(
    req: Request
  ): Promise<
    | { ok: true; artifactId: string; type?: string }
    | { ok: false; status: number; body: Record<string, unknown> }
  > {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return { ok: false, status: 400, body: { ok: false, error: "Invalid JSON body" } };
    }

    const payload = body as { artifactId?: string; type?: string };
    const artifactId = typeof payload.artifactId === "string" ? payload.artifactId.trim() : "";

    if (!artifactId) {
      return {
        ok: false,
        status: 400,
        body: { ok: false, error: "artifactId is required" },
      };
    }

    return { ok: true, artifactId, type: typeof payload.type === "string" ? payload.type : undefined };
  }

  private async compileArtifact(artifactId: string): Promise<{
    bundleKey: string;
    runtimeManifestKey: string;
    warnings: string[];
    runtimeType: RuntimeArtifactType;
    bundleSizeBytes: number;
  }> {
    const startedAt = Date.now();
    const row = (await this.env.DB.prepare(
      `
        SELECT
          a.id,
          a.capsule_id,
          a.type,
          a.runtime_version,
          a.bundle_digest,
          a.status,
          a.policy_status,
          a.visibility,
          c.manifest_json as capsule_manifest_json,
          c.hash as capsule_hash
        FROM artifacts a
        INNER JOIN capsules c ON c.id = a.capsule_id
        WHERE a.id = ?
        LIMIT 1
      `
    )
      .bind(artifactId)
      .first()) as ArtifactRow | null;

    if (!row) {
      throw new ArtifactCompileError(404, { error: "Artifact not found" });
    }

    const manifest = requireCapsuleManifest(row.capsule_manifest_json, {
      source: "artifact-compile",
      capsuleId: row.capsule_id,
    });

    const runtimeType = this.resolveRuntimeType(row.type, manifest);
    const capsuleFiles = await listCapsuleFiles(this.env.R2, row.capsule_hash);
    const entryObject = await downloadCapsuleFile(this.env.R2, row.capsule_hash, manifest.entry);
    if (!entryObject) {
      throw new ArtifactCompileError(404, { error: "Capsule entry file not found" });
    }

    const entrySource = await entryObject.text();
    let compiledCode: string;
    let warnings: string[] = [];

    if (runtimeType === "html") {
      const htmlResult = compileHtmlArtifact({ html: entrySource });
      if (!htmlResult.ok) {
        this.writeCompileAnalytics({
          outcome: "error",
          artifactId,
          runtimeType,
          errorCode: htmlResult.errorCode,
          elapsedMs: Date.now() - startedAt,
        });
        throw new ArtifactCompileError(400, {
          error: "compile_failed",
          code: htmlResult.errorCode,
          message: htmlResult.message,
          details: htmlResult.details,
        });
      }
      compiledCode = htmlResult.html;
      warnings = htmlResult.warnings ?? [];
    } else {
      const additionalFiles = await this.loadAdditionalFiles(
        row.capsule_hash,
        capsuleFiles,
        manifest.entry
      );
      const reactResult = await compileReactArtifact({
        code: entrySource,
        entry: manifest.entry,
        additionalFiles,
      });
      if (!reactResult.ok) {
        this.writeCompileAnalytics({
          outcome: "error",
          artifactId,
          runtimeType,
          errorCode: reactResult.errorCode,
          elapsedMs: Date.now() - startedAt,
        });
        throw new ArtifactCompileError(400, {
          error: "compile_failed",
          code: reactResult.errorCode,
          message: reactResult.message,
          details: reactResult.details,
        });
      }
      compiledCode = reactResult.code;
      warnings = reactResult.warnings ?? [];
    }

    const bundleBytes = TEXT_ENCODER.encode(compiledCode);
    const bundleDigest = await generateContentHash(
      bundleBytes.buffer.slice(
        bundleBytes.byteOffset,
        bundleBytes.byteOffset + bundleBytes.byteLength
      )
    );
    const bundleKey = `artifacts/${artifactId}/bundle.js`;
    const contentType = runtimeType === "html" ? "text/html" : "application/javascript";

    await this.env.R2.put(bundleKey, compiledCode, {
      httpMetadata: { contentType },
    });

    const runtimeVersion = row.runtime_version || DEFAULT_RUNTIME_VERSION;
    const runtimeManifest = buildRuntimeManifest({
      artifactId,
      type: runtimeType,
      bundleKey,
      bundleSizeBytes: bundleBytes.byteLength,
      bundleDigest,
      runtimeVersion,
    });

    const runtimeManifestJson = JSON.stringify(runtimeManifest);
    const runtimeManifestKey = `artifacts/${artifactId}/v1/runtime-manifest.json`;

    await this.env.R2.put(runtimeManifestKey, runtimeManifestJson, {
      httpMetadata: { contentType: "application/json" },
    });
    await this.env.R2.put(`artifacts/${artifactId}/manifest.json`, runtimeManifestJson, {
      httpMetadata: { contentType: "application/json" },
    });

    if (this.env.RUNTIME_MANIFEST_KV) {
      try {
        await this.env.RUNTIME_MANIFEST_KV.put(runtimeManifestKey, runtimeManifestJson);
      } catch (err) {
        console.error("E-VIBECODR-1203 runtime manifest KV write failed", {
          artifactId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const manifestVersionRow = (await this.env.DB.prepare(
      "SELECT MAX(version) as max_version FROM artifact_manifests WHERE artifact_id = ?"
    )
      .bind(artifactId)
      .first()) as ManifestVersionRow | null;
    const nextVersion =
      manifestVersionRow && typeof manifestVersionRow.max_version === "number"
        ? manifestVersionRow.max_version + 1
        : 1;

    const runtimeManifestBytes = TEXT_ENCODER.encode(runtimeManifestJson);
    await this.env.DB.prepare(
      "INSERT INTO artifact_manifests (id, artifact_id, version, manifest_json, size_bytes, runtime_version) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(
        crypto.randomUUID(),
        artifactId,
        nextVersion,
        runtimeManifestJson,
        runtimeManifestBytes.byteLength,
        runtimeVersion
      )
      .run();

    const nextStatus = row.status === "draft" ? "active" : row.status || "active";
    const nextVisibility =
      row.visibility === "unlisted" || row.visibility === "public" ? row.visibility : "public";
    const nextPolicy = row.policy_status || "active";

    await this.env.DB.prepare(
      "UPDATE artifacts SET bundle_digest = ?, runtime_version = ?, status = ?, visibility = ?, policy_status = ? WHERE id = ?"
    )
      .bind(bundleDigest, runtimeVersion, nextStatus, nextVisibility, nextPolicy, artifactId)
      .run();

    this.recordWarnings(warnings);
    this.writeAnalytics("artifact_compile_success", [bundleBytes.byteLength], [runtimeType]);
    this.writeCompileAnalytics({
      outcome: "success",
      artifactId,
      runtimeType,
      bundleSizeBytes: bundleBytes.byteLength,
      warnings: warnings.length,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      bundleKey,
      runtimeManifestKey,
      warnings,
      runtimeType,
      bundleSizeBytes: bundleBytes.byteLength,
    };
  }

  private resolveRuntimeType(type: string | undefined, manifest: Manifest): RuntimeArtifactType {
    const normalizedType = (type || "").trim();
    for (const candidate of RUNTIME_ARTIFACT_TYPES) {
      if (candidate === normalizedType) {
        return candidate;
      }
    }

    const runner = (manifest.runner || "").toLowerCase();
    if (runner === "client-html") return "html";
    if (runner === "client-react") return "react-jsx";
    if (runner === "client-static") {
      const entryLower = manifest.entry.toLowerCase();
      return entryLower.endsWith(".html") || entryLower.endsWith(".htm") ? "html" : "react-jsx";
    }

    if (runner === "webcontainer" || runner === "worker-edge") {
      throw new ArtifactCompileError(400, { error: "Unsupported runner for artifact compile", runner });
    }

    return "react-jsx";
  }

  private async loadAdditionalFiles(
    capsuleHash: string,
    files: Array<{ path: string }>,
    entryPath: string
  ): Promise<Record<string, string>> {
    const additional: Record<string, string> = {};
    const skip = new Set(["manifest.json", "metadata.json", entryPath]);

    for (const file of files) {
      if (!file?.path || skip.has(file.path)) continue;
      if (!this.isTextFile(file.path)) continue;

      try {
        const obj = await downloadCapsuleFile(this.env.R2, capsuleHash, file.path);
        if (!obj) continue;
        const content = await obj.arrayBuffer();
        additional[file.path] = TEXT_DECODER.decode(content);
      } catch (err) {
        console.error("E-VIBECODR-1109 artifact compile additional file read failed", {
          path: file.path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return additional;
  }

  private isTextFile(path: string): boolean {
    const parts = path.toLowerCase().split(".");
    const ext = parts.length > 1 ? parts.pop() : "";
    return !!ext && TEXT_EXTENSIONS.has(ext);
  }

  private async recordLastCompileRequest(artifactId: string, type?: string): Promise<void> {
    try {
      await this.state.storage.put("lastCompileRequest", {
        artifactId,
        type,
        receivedAt: Date.now(),
      });
    } catch (err) {
      console.error(
        `${ERROR_ARTIFACT_COMPILER_STATE_WRITE_FAILED} ArtifactCompiler lastCompileRequest write failed`,
        {
          artifactId,
          error: err instanceof Error ? err.message : String(err),
        }
      );
    }
  }

  private async recordLastCompileResult(
    artifactId: string,
    outcome: "success" | "error",
    details?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.state.storage.put("lastCompileResult", {
        artifactId,
        outcome,
        details,
        completedAt: Date.now(),
      });
    } catch (err) {
      console.error(
        `${ERROR_ARTIFACT_COMPILER_STATE_WRITE_FAILED} ArtifactCompiler lastCompileResult write failed`,
        {
          artifactId,
          error: err instanceof Error ? err.message : String(err),
        }
      );
    }
  }

  private writeAnalytics(blob: string, doubles?: number[], indexes?: string[]): void {
    try {
      const analytics = this.env.vibecodr_analytics_engine;
      if (!analytics || typeof analytics.writeDataPoint !== "function") {
        return;
      }
      analytics.writeDataPoint({
        blobs: [blob],
        doubles,
        indexes,
      });
    } catch (err) {
      console.error(
        `${ERROR_ARTIFACT_COMPILER_ANALYTICS_FAILED} ArtifactCompiler analytics write failed`,
        {
          error: err instanceof Error ? err.message : String(err),
        }
      );
    }
  }

  private recordWarnings(warnings: string[]): void {
    if (!warnings || warnings.length === 0) return;
    const mapped: PublishWarning[] = warnings.map((message) => ({
      path: "bundle.compile",
      message,
    }));
    recordBundleWarningMetrics(this.env as Env, mapped, "artifactCompile");
  }
}
