import type { Env } from "../index";
import {
  ERROR_ARTIFACT_COMPILER_STATE_WRITE_FAILED,
  ERROR_ARTIFACT_COMPILER_ANALYTICS_FAILED,
} from "@vibecodr/shared";

type ArtifactCompilerEnv = Pick<Env, "vibecodr_analytics_engine">;

export class ArtifactCompiler {
  private state: DurableObjectState;
  private env: ArtifactCompilerEnv;

  constructor(state: DurableObjectState, env: ArtifactCompilerEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname.endsWith("/compile")) {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid JSON body" }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        );
      }

      const payload = body as { artifactId?: string; type?: string };
      const artifactId = typeof payload.artifactId === "string" ? payload.artifactId.trim() : "";

      if (!artifactId) {
        return new Response(
          JSON.stringify({ ok: false, error: "artifactId is required" }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        );
      }

      try {
        await this.state.storage.put("lastCompileRequest", {
          artifactId,
          type: typeof payload.type === "string" ? payload.type : undefined,
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

      try {
        // WHY: Best-effort analytics for compile enqueues; failures are logged with structured error codes
        // but do not affect the response.
        const analytics = this.env.vibecodr_analytics_engine;
        if (analytics && typeof analytics.writeDataPoint === "function") {
          analytics.writeDataPoint({
            blobs: ["artifact_compile_queued"],
            doubles: [1],
          });
        }
      } catch (err) {
        console.error(
          `${ERROR_ARTIFACT_COMPILER_ANALYTICS_FAILED} ArtifactCompiler analytics write failed`,
          {
            artifactId,
            error: err instanceof Error ? err.message : String(err),
          }
        );
      }

      return new Response(JSON.stringify({ ok: true, queued: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
}
