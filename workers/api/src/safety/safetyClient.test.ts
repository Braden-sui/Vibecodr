import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { collectSuspiciousPatterns, runSafetyCheck } from "./safetyClient";

const baseEnv: any = {
  AWSBEDROCKAPI: "token",
  BEDROCK_REGION: "us-west-2",
  BEDROCK_SAFETY_MODEL: "openai.gpt-oss-120b-1:0",
  SAFETY_ENABLED: "true",
  vibecodr_analytics_engine: { writeDataPoint: vi.fn() },
};

describe("safetyClient collectSuspiciousPatterns", () => {
  it("finds common risky patterns", () => {
    const code = `
      import { exec } from "child_process";
      const data = process.env.SECRET;
      fetch("http://example.com");
    `;
    const hits = collectSuspiciousPatterns(code);
    expect(hits).toEqual(
      expect.arrayContaining([
        "child_process|exec|spawn|fork",
        "process\\.env",
        "fetch|axios|http\\.request|net\\.connect",
      ])
    );
  });
});

describe("safetyClient runSafetyCheck", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    // @ts-expect-error assigning mock fetch for tests
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks on hard-block patterns immediately", async () => {
    const verdict = await runSafetyCheck(baseEnv, {
      code: "require('child_process').exec('xmrig')",
      language: "javascript",
      environment: "capsule",
    });
    expect(verdict.safe).toBe(false);
    expect(verdict.reasons[0]).toMatch(/hard-block/i);
  });

  it("fails closed when token is missing", async () => {
    const verdict = await runSafetyCheck({ ...baseEnv, AWSBEDROCKAPI: undefined }, {
      code: "console.log(1);",
      language: "javascript",
      environment: "capsule",
    });
    expect(verdict.safe).toBe(false);
    expect(verdict.reasons[0]).toMatch(/missing AWS Bedrock token/);
  });

  it("parses a successful model response", async () => {
    const content = JSON.stringify({
      safe: true,
      risk_level: "low",
      reasons: ["ok"],
      blocked_capabilities: [],
      tags: ["model"],
    });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    });

    const verdict = await runSafetyCheck(baseEnv, {
      code: "console.log('hi');",
      language: "javascript",
      environment: "capsule",
    });

    expect(verdict.safe).toBe(true);
    expect(verdict.risk_level).toBe("low");
    expect(verdict.tags).toContain("model");
  });

  it("fails closed on HTTP error", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const verdict = await runSafetyCheck(baseEnv, {
      code: "console.log('hi');",
      language: "javascript",
      environment: "capsule",
    });

    expect(verdict.safe).toBe(false);
    expect(verdict.tags).toContain("model_error");
  });

  it("fails closed on malformed model response", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "" } }] }),
    });

    const verdict = await runSafetyCheck(baseEnv, {
      code: "console.log('hi');",
      language: "javascript",
      environment: "capsule",
    });

    expect(verdict.safe).toBe(false);
    expect(verdict.tags).toContain("parse_error");
  });

  it("adds truncated tag when code is long", async () => {
    const longCode = "a".repeat(13000);
    const content = JSON.stringify({
      safe: true,
      risk_level: "low",
      reasons: ["ok"],
      blocked_capabilities: [],
      tags: [],
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    });
    // @ts-expect-error override
    global.fetch = fetchMock;

    const verdict = await runSafetyCheck(baseEnv, {
      code: longCode,
      language: "javascript",
      environment: "capsule",
    });

    expect(verdict.tags).toContain("truncated");
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.messages[1].content).toContain("/* truncated */");
  });

  it("times out and blocks when the model hangs", async () => {
    vi.useFakeTimers();
    // Simulate a fetch that never resolves
    const fetchPromise = new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error("aborted")), 50);
    });
    // @ts-expect-error override
    global.fetch = vi.fn().mockReturnValue(fetchPromise);

    const verdictPromise = runSafetyCheck({ ...baseEnv, SAFETY_TIMEOUT_MS: "5" }, {
      code: "console.log('hi');",
      language: "javascript",
      environment: "capsule",
    });

    await vi.runAllTimersAsync();
    const verdict = await verdictPromise;
    expect(verdict.safe).toBe(false);
    expect(verdict.tags).toContain("timeout");
  });
});
