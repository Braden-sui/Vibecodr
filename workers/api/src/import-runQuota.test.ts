/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Env } from "./index";
import { importGithub, importZip } from "./handlers/import";

vi.mock("../auth", () => {
  return {
    requireAuth:
      (handler: any) =>
      (req: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>) =>
        handler(
          req,
          env,
          ctx,
          params,
          {
            userId: "user-1",
            sessionId: "sess-1",
            claims: {} as any,
          } as any
        ),
  };
});

const getUserRunQuotaStateMock = vi.fn();

vi.mock("../storage/quotas", () => {
  return {
    getUserRunQuotaState: getUserRunQuotaStateMock,
  };
});

const createEnv = (): Env => {
  return {
    DB: {} as any,
    R2: {} as any,
    RUNTIME_MANIFEST_KV: {} as any,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "https://clerk.example",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    vibecodr_analytics_engine: {} as any,
  } as any;
};

describe("import handlers run quota enforcement", () => {
  let env: Env;

  beforeEach(() => {
    env = createEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects GitHub import when run quota is exceeded and does not call fetch", async () => {
    getUserRunQuotaStateMock.mockResolvedValueOnce({
      plan: "free",
      runsThisMonth: 6000,
      result: {
        allowed: false,
        reason: "Monthly run quota exceeded (6000/5000).",
        limits: { maxRuns: 5000 } as any,
        usage: { runs: 6000 } as any,
      },
    });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const req = new Request("https://worker.test/import/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/example/repo", branch: "main" }),
    });

    const res = await importGithub(req, env, {} as any, {} as any);

    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Run quota exceeded");
    expect(body.reason).toContain("Monthly run quota exceeded");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects ZIP import when run quota is exceeded", async () => {
    getUserRunQuotaStateMock.mockResolvedValueOnce({
      plan: "free",
      runsThisMonth: 6000,
      result: {
        allowed: false,
        reason: "Monthly run quota exceeded (6000/5000).",
        limits: { maxRuns: 5000 } as any,
        usage: { runs: 6000 } as any,
      },
    });

    const zipBuffer = new ArrayBuffer(16);
    const req = new Request("https://worker.test/import/zip", {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: zipBuffer,
    });

    const res = await importZip(req, env, {} as any, {} as any);

    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Run quota exceeded");
    expect(body.reason).toContain("Monthly run quota exceeded");
  });
});

