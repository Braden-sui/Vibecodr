/// <reference types="vitest" />
import { describe, it, expect, vi } from "vitest";
import type { Env } from "../index";
import { appendRunLogs } from "./runs";

const createEnv = (): Env => ({
  DB: {} as any,
  R2: {} as any,
  vibecodr_analytics_engine: {
    writeDataPoint: vi.fn(),
  } as any,
  ALLOWLIST_HOSTS: "[]",
  BUILD_COORDINATOR_DURABLE: {} as any,
  ARTIFACT_COMPILER_DURABLE: {} as any,
} as any);

describe("appendRunLogs", () => {
  it("rejects payloads without logs", async () => {
    const env = createEnv();
    const res = await appendRunLogs(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ capsuleId: "cap1" }),
      }),
      env,
      {} as any,
      { p1: "run1" }
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("logs array required");
  });

  it("writes sanitized logs to Analytics Engine", async () => {
    const env = createEnv();
    const res = await appendRunLogs(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({
          capsuleId: "cap1",
          postId: "post1",
          logs: [
            { level: "warn", message: "hello", timestamp: 123, source: "player", sampleRate: 0.5 },
            { level: "nope", message: { nested: true } },
          ],
        }),
      }),
      env,
      {} as any,
      { p1: "run-log-1" }
    );

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { accepted: number };
    expect(payload.accepted).toBe(2);

    const writeSpy = env.vibecodr_analytics_engine.writeDataPoint as ReturnType<typeof vi.fn>;
    expect(writeSpy).toHaveBeenCalledTimes(2);
    const firstCall = writeSpy.mock.calls[0][0];
    expect(firstCall.indexes[0]).toBe("run-log-1");
    expect(firstCall.blobs[1]).toBe("warn");
    const secondCall = writeSpy.mock.calls[1][0];
    expect(secondCall.blobs[2]).toBe("player");
    expect(typeof secondCall.doubles[0]).toBe("number");
  });
});
