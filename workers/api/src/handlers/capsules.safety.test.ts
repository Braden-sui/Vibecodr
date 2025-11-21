import { describe, it, expect, vi, beforeEach } from "vitest";
import { enforceSafetyForFiles, PublishCapsuleError } from "./capsules";
import type { Manifest } from "@vibecodr/shared/manifest";

vi.mock("../safety/safetyClient");
import * as safetyModule from "../safety/safetyClient";
const runSafetyCheck = safetyModule.runSafetyCheck as unknown as vi.Mock;
const logSafetyVerdict = safetyModule.logSafetyVerdict as unknown as vi.Mock;

describe("enforceEntrySafety", () => {
  const manifest: Manifest = {
    id: "test",
    entry: "index.html",
    version: "1.0.0",
    runtime: { type: "html", version: "1" },
    files: [],
  };

  const baseEnv: any = {
    AWSBEDROCKAPI: "token",
    BEDROCK_REGION: "us-west-2",
    vibecodr_analytics_engine: { writeDataPoint: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("allows safe verdicts", async () => {
    runSafetyCheck.mockResolvedValue({
      safe: true,
      risk_level: "low",
      reasons: ["ok"],
      blocked_capabilities: [],
      tags: [],
    });

    await expect(
      enforceSafetyForFiles(baseEnv, manifest, [
        {
          path: "index.html",
          content: new TextEncoder().encode("<div>ok</div>").buffer,
          contentType: "text/html",
          size: 12,
        },
      ])
    ).resolves.not.toThrow();

    expect(runSafetyCheck).toHaveBeenCalled();
    expect(logSafetyVerdict).toHaveBeenCalled();
  });

  it("blocks unsafe verdicts", async () => {
    runSafetyCheck.mockResolvedValue({
      safe: false,
      risk_level: "high",
      reasons: ["malicious"],
      blocked_capabilities: ["execution"],
      tags: ["test"],
    });

    await expect(
      enforceSafetyForFiles(baseEnv, manifest, [
        {
          path: "index.html",
          content: new TextEncoder().encode("<div>script</div>").buffer,
          contentType: "text/html",
          size: 18,
        },
      ])
    ).rejects.toBeInstanceOf(PublishCapsuleError);
  });
});
