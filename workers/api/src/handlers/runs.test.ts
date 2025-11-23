/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../index";
import { appendRunLogs, completeRun, startRun } from "./runs";
import { Plan, PLAN_LIMITS } from "../storage/quotas";

const mockGetUserRunQuotaState = vi.fn();
const incrementUserCountersMock = vi.fn();
const incrementPostStatsMock = vi.fn();

vi.mock("../auth", () => ({
  requireAuth:
    (handler: any) =>
    (req: any, env: Env, ctx: any, params: any) =>
      handler(req, env, ctx, params, {
        userId: "user-auth-1",
        sessionId: "sess1",
        claims: {} as any,
      }),
}));

vi.mock("./counters", () => ({
  incrementUserCounters: (...args: Parameters<typeof incrementUserCountersMock>) =>
    incrementUserCountersMock(...args),
  incrementPostStats: (...args: Parameters<typeof incrementPostStatsMock>) =>
    incrementPostStatsMock(...args),
}));

vi.mock("../storage/quotas", async () => {
  const actual = await vi.importActual<typeof import("../storage/quotas")>("../storage/quotas");
  return {
    ...actual,
    getUserRunQuotaState: (...args: Parameters<typeof actual.getUserRunQuotaState>) =>
      mockGetUserRunQuotaState(...args),
  };
});

type RunRow = {
  id: string;
  capsule_id: string;
  post_id: string | null;
  user_id: string;
  started_at?: number;
  duration_ms?: number | null;
  status?: string | null;
};

type TestEnv = Env & { __state: { runs: Map<string, RunRow> } };

function createEnv(runs: RunRow[] = []): TestEnv {
  const state = { runs: new Map<string, RunRow>() };
  runs.forEach((run) => state.runs.set(run.id, { ...run }));
  const prepare = vi.fn((sql: string) => {
    const stmt: any = {
      sql,
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async all() {
        if (sql.includes("FROM runs WHERE id = ?")) {
          const runId = this.bindArgs[0];
          const run = state.runs.get(runId);
          return { results: run ? [run] : [] };
        }
        return { results: [] };
      },
      async run() {
        if (sql.startsWith("INSERT INTO runs")) {
          if (sql.includes("duration_ms")) {
            const [id, capsuleId, postId, userId, durationMs, status, errorMessage] = this.bindArgs;
            if (state.runs.has(id)) {
              const err: any = new Error("UNIQUE constraint failed: runs.id");
              throw err;
            }
            state.runs.set(id, {
              id,
              capsule_id: capsuleId,
              post_id: postId ?? null,
              user_id: userId,
              started_at: Math.floor(Date.now() / 1000),
              duration_ms: durationMs ?? null,
              status: status ?? errorMessage ?? null,
            });
          } else {
            const [id, capsuleId, postId, userId, status] = this.bindArgs;
            if (state.runs.has(id)) {
              const err: any = new Error("UNIQUE constraint failed: runs.id");
              throw err;
            }
            state.runs.set(id, {
              id,
              capsule_id: capsuleId,
              post_id: postId ?? null,
              user_id: userId,
              started_at: Math.floor(Date.now() / 1000),
              duration_ms: null,
              status: status ?? null,
            });
          }
        }
        return { success: true };
      },
    };
    return stmt;
  });
  return {
    DB: { prepare } as any,
    R2: {} as any,
    vibecodr_analytics_engine: {
      writeDataPoint: vi.fn(),
    } as any,
    ALLOWLIST_HOSTS: "[]",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    __state: state,
  } as any;
}

beforeEach(() => {
  mockGetUserRunQuotaState.mockReset();
  mockGetUserRunQuotaState.mockResolvedValue({
    plan: Plan.FREE,
    runsThisMonth: 0,
    result: { allowed: true, percentUsed: 0, limits: PLAN_LIMITS[Plan.FREE] },
  });
  incrementUserCountersMock.mockReset();
  incrementPostStatsMock.mockReset();
  incrementUserCountersMock.mockResolvedValue(undefined as any);
  incrementPostStatsMock.mockResolvedValue(undefined as any);
});

describe("startRun", () => {
  it("rejects when run quota is exceeded with structured payload", async () => {
    const env = createEnv();
    mockGetUserRunQuotaState.mockResolvedValueOnce({
      plan: Plan.FREE,
      runsThisMonth: 6000,
      result: {
        allowed: false,
        reason: "Monthly run quota exceeded",
        limits: PLAN_LIMITS[Plan.FREE],
        usage: { bundleSize: 0, runs: 6000, storage: 0, liveMinutes: 0 },
        percentUsed: 120,
      },
    });

    const res = await startRun(
      new Request("https://example.com/api/runs/start", {
        method: "POST",
        body: JSON.stringify({ capsuleId: "cap-1", postId: "post-1", runId: "run-limit" }),
      }),
      env,
      {} as any,
      {}
    );

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; plan?: string; limits?: any; usage?: any };
    expect(body.error).toBe("Run quota exceeded");
    expect(body.plan).toBe(Plan.FREE);
    expect(body.limits?.maxRuns).toBe(PLAN_LIMITS[Plan.FREE].maxRuns);
    expect(body.usage?.runs).toBe(6000);
    expect(env.__state.runs.size).toBe(0);
  });

  it("creates a run and increments counters", async () => {
    const env = createEnv();

    const res = await startRun(
      new Request("https://example.com/api/runs/start", {
        method: "POST",
        body: JSON.stringify({ runId: "run-start", capsuleId: "cap-start", postId: "post-start" }),
      }),
      env,
      {} as any,
      {}
    );

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { runId?: string };
    expect(payload.runId).toBe("run-start");
    expect(env.__state.runs.get("run-start")?.user_id).toBe("user-auth-1");
    expect(incrementUserCountersMock).toHaveBeenCalledTimes(1);
    expect(incrementPostStatsMock).toHaveBeenCalledTimes(1);
  });
});

describe("completeRun", () => {
  it("rejects when run quota is exceeded", async () => {
    const env = createEnv();
    mockGetUserRunQuotaState.mockResolvedValueOnce({
      plan: Plan.FREE,
      runsThisMonth: 6000,
      result: {
        allowed: false,
        reason: "Monthly run quota exceeded",
        limits: PLAN_LIMITS[Plan.FREE],
        usage: { bundleSize: 0, runs: 6000, storage: 0, liveMinutes: 0 },
      },
    });

    const res = await completeRun(
      new Request("https://example.com/api/runs/complete", {
        method: "POST",
        body: JSON.stringify({ runId: "run-limit", capsuleId: "cap-1" }),
      }),
      env,
      {} as any,
      {}
    );

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; plan?: string; limits?: any; usage?: any };
    expect(body.error).toBe("Run quota exceeded");
    expect(body.plan).toBe(Plan.FREE);
    expect(body.limits?.maxRuns).toBe(PLAN_LIMITS[Plan.FREE].maxRuns);
    expect(body.usage?.runs).toBe(6000);
    expect(env.__state.runs.size).toBe(0);
    expect(mockGetUserRunQuotaState).toHaveBeenCalledWith("user-auth-1", env);
  });

  it("stores runs using the authenticated user id", async () => {
    const env = createEnv();

    const res = await completeRun(
      new Request("https://example.com/api/runs/complete", {
        method: "POST",
        headers: { Authorization: "Bearer spoofed-user" },
        body: JSON.stringify({ runId: "run-auth", capsuleId: "cap-1", postId: "post-1", durationMs: 10 }),
      }),
      env,
      {} as any,
      {}
    );

    expect(res.status).toBe(200);
    const run = env.__state.runs.get("run-auth");
    expect(run?.user_id).toBe("user-auth-1");
  });

  it("does not increment counters again when completing an existing run", async () => {
    const env = createEnv();
    await startRun(
      new Request("https://example.com/api/runs/start", {
        method: "POST",
        body: JSON.stringify({ runId: "run-existing-complete", capsuleId: "cap-1", postId: "post-1" }),
      }),
      env,
      {} as any,
      {}
    );
    incrementUserCountersMock.mockClear();
    incrementPostStatsMock.mockClear();

    const res = await completeRun(
      new Request("https://example.com/api/runs/complete", {
        method: "POST",
        body: JSON.stringify({ runId: "run-existing-complete", capsuleId: "cap-1", postId: "post-1" }),
      }),
      env,
      {} as any,
      {}
    );

    expect(res.status).toBe(200);
    expect(incrementUserCountersMock).not.toHaveBeenCalled();
    expect(incrementPostStatsMock).not.toHaveBeenCalled();
  });

  it("returns 403 when a run id is already owned by a different user", async () => {
    const env = createEnv([
      { id: "run-existing", capsule_id: "cap-1", post_id: "post-1", user_id: "other-user" },
    ]);

    const res = await completeRun(
      new Request("https://example.com/api/runs/complete", {
        method: "POST",
        body: JSON.stringify({ runId: "run-existing", capsuleId: "cap-1" }),
      }),
      env,
      {} as any,
      {}
    );

    expect(res.status).toBe(403);
    expect(env.__state.runs.get("run-existing")?.user_id).toBe("other-user");
  });
});

describe("appendRunLogs", () => {
  it("allows logging before the run record exists", async () => {
    const env = createEnv();
    const res = await appendRunLogs(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ logs: [{ level: "info", message: "test" }], capsuleId: "cap1", postId: "p1" }),
      }),
      env,
      {} as any,
      { p1: "missing-run" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number };
    expect(body.accepted).toBe(1);
    const writeSpy = env.vibecodr_analytics_engine.writeDataPoint as ReturnType<typeof vi.fn>;
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects when the run belongs to another user", async () => {
    const env = createEnv([{ id: "run1", capsule_id: "cap1", post_id: "post1", user_id: "other-user" }]);
    const res = await appendRunLogs(
      new Request("https://example.com", {
        method: "POST",
        body: JSON.stringify({ logs: [{ level: "info", message: "test" }], capsuleId: "cap1", postId: "post1" }),
      }),
      env,
      {} as any,
      { p1: "run1" }
    );

    expect(res.status).toBe(403);
  });

  it("rejects payloads without logs", async () => {
    const env = createEnv([{ id: "run1", capsule_id: "cap1", post_id: "post1", user_id: "user-auth-1" }]);
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
    const env = createEnv([{ id: "run-log-1", capsule_id: "cap1", post_id: "post1", user_id: "user-auth-1" }]);
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
