import { describe, it, expect, vi } from "vitest";
import { ArtifactCompiler } from "./ArtifactCompiler";

function createState() {
  const storage = {
    put: vi.fn().mockResolvedValue(undefined),
  };
  const state = { storage } as unknown as DurableObjectState;
  return { state, storage };
}

function createEnv() {
  const vibecodr_analytics_engine = {
    writeDataPoint: vi.fn(),
  };
  return { vibecodr_analytics_engine } as any;
}

describe("ArtifactCompiler", () => {
  it("returns 400 when artifactId is missing", async () => {
    const { state } = createState();
    const compiler = new ArtifactCompiler(state, createEnv());
    const req = new Request("https://example/compile", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await compiler.fetch(req);
    expect(res.status).toBe(400);
  });

  it("queues compile requests and returns 202", async () => {
    const { state, storage } = createState();
    const env = createEnv();
    const compiler = new ArtifactCompiler(state, env);
    const req = new Request("https://example/compile", {
      method: "POST",
      body: JSON.stringify({ artifactId: "artifact-1", type: "react-jsx" }),
    });

    const res = await compiler.fetch(req);
    expect(res.status).toBe(202);

    const json = (await res.json()) as { ok: boolean; queued: boolean };
    expect(json.ok).toBe(true);
    expect(json.queued).toBe(true);

    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.put).toHaveBeenCalledWith(
      "lastCompileRequest",
      expect.objectContaining({ artifactId: "artifact-1" })
    );

    const analytics = (env.vibecodr_analytics_engine.writeDataPoint as any) || null;
    expect(analytics).toBeTruthy();
    expect(analytics.mock.calls.length).toBe(1);
    const callArg = analytics.mock.calls[0][0];
    expect(callArg.blobs[0]).toBe("artifact_compile_queued");
  });
});
