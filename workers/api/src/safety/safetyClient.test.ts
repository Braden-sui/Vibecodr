import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { collectSuspiciousPatterns, runSafetyCheck } from "./safetyClient";

const baseEnv: any = {
  SAFETY_ENABLED: "true",
  vibecodr_analytics_engine: { writeDataPoint: vi.fn() },
  RUNTIME_MANIFEST_KV: {
    get: vi.fn(),
  },
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
    baseEnv.RUNTIME_MANIFEST_KV.get = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows by default and tags mvp allow", async () => {
    const verdict = await runSafetyCheck(baseEnv, {
      code: "console.log('hi');",
      language: "javascript",
      environment: "capsule",
    });
    expect(verdict.safe).toBe(true);
    expect(verdict.risk_level).toBe("low");
    expect(verdict.tags).toContain("mvp-allow");
  });

  it("blocks when code hash is listed in env blocklist", async () => {
    const code = "blocked content";
    const codeHash = "0f079ed2e5bd4acdb94eef170679fd8ae9ec5fd54dd1ab08f9d46556ceb2cc97";
    const verdict = await runSafetyCheck(
      { ...baseEnv, SAFETY_BLOCKED_CODE_HASHES: JSON.stringify([codeHash]) },
      { code, language: "javascript", environment: "capsule", codeHash }
    );
    expect(verdict.safe).toBe(false);
    expect(verdict.tags).toContain("hash_block");
  });

  it("blocks when KV blocklist entry exists", async () => {
    const code = "kv blocked content";
    const codeHash = "810c939938b17bc0aeaf6785d472866c16ab274c4accdd0a47d023cf42ab26ce";
    (baseEnv.RUNTIME_MANIFEST_KV.get as any).mockResolvedValue("kv block");

    const verdict = await runSafetyCheck(baseEnv, {
      code,
      language: "javascript",
      environment: "capsule",
      codeHash,
    });
    expect(baseEnv.RUNTIME_MANIFEST_KV.get).toHaveBeenCalled();
    expect(verdict.safe).toBe(false);
    expect(verdict.tags).toContain("kv_blocklist");
  });

  it("surfaces heuristics without blocking when suspicious patterns exist", async () => {
    const verdict = await runSafetyCheck(baseEnv, {
      code: "while(true){} process.env.FOO",
      language: "javascript",
      environment: "capsule",
    });
    expect(verdict.safe).toBe(true);
    expect(verdict.risk_level).toBe("medium");
    expect(verdict.tags).toContain("heuristics");
  });
});
