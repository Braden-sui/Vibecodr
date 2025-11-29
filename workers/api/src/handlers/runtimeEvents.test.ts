/// <reference types="vitest" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import {
  RATE_LIMIT_MAX_KEYS,
  consumeRateLimit,
  getClientIp,
  getRateLimitBucketCount,
  buildRuntimeAnalyticsSummary,
  recordRuntimeEvent,
  RUNTIME_EVENT_MAX_BYTES,
  RUNTIME_EVENT_MAX_CLOCK_SKEW_MS,
  RUNTIME_EVENT_PROPERTIES_MAX_BYTES,
  resetAnalyticsRateLimitState,
} from "./runtimeEvents";
import { ERROR_RUNTIME_ANALYTICS_FAILED } from "@vibecodr/shared";

const makeEnv = (overrides: Partial<Env> = {}) => {
  const boundValues: any[][] = [];
  const db = {
    prepare: vi.fn(() => ({
      bind: (...args: any[]) => {
        boundValues.push(args);
        return { run: vi.fn().mockResolvedValue(undefined) };
      },
    })),
    batch: vi.fn(),
    exec: vi.fn(),
    dump: vi.fn(),
    withSession: vi.fn(),
  };
  const env: Env = {
    DB: db as unknown as D1Database,
    R2: {} as any,
    vibecodr_analytics_engine: {
      writeDataPoint: vi.fn(),
    } as any,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "test-issuer",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    RATE_LIMIT_SHARD: {} as any,
    ...overrides,
  };

  return { env, boundValues };
};

const noopCtx: any = {};
const noopParams: any = {};

beforeEach(() => {
  resetAnalyticsRateLimitState();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  resetAnalyticsRateLimitState();
  vi.useRealTimers();
});

describe("runtimeEvents getClientIp", () => {
  it("uses Cloudflare provided IP and ignores spoofed client headers", () => {
    const request = new Request("https://worker.test/api/runtime-events", {
      headers: {
        "cf-connecting-ip": "203.0.113.5",
        "x-forwarded-for": "198.51.100.7, 198.51.100.8",
      },
    });

    expect(getClientIp(request)).toBe("203.0.113.5");
  });

  it("accepts true-client-ip when cf-connecting-ip is missing", () => {
    const request = new Request("https://worker.test/api/runtime-events", {
      headers: {
        "true-client-ip": "203.0.113.9",
      },
    });

    expect(getClientIp(request)).toBe("203.0.113.9");
  });

  it("returns unknown when no trusted headers are present", () => {
    const request = new Request("https://worker.test/api/runtime-events");

    expect(getClientIp(request)).toBe("unknown");
  });
});

describe("runtimeEvents rate limit store", () => {
  it("caps bucket count and evicts oldest when new keys exceed capacity", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_KEYS; i++) {
      vi.setSystemTime(i * 1000);
      expect(consumeRateLimit(`ip-${i}`)).toBe(true);
    }

    expect(getRateLimitBucketCount()).toBe(RATE_LIMIT_MAX_KEYS);

    vi.setSystemTime(RATE_LIMIT_MAX_KEYS * 1000 + 100);
    expect(consumeRateLimit("new-ip")).toBe(true);
    expect(getRateLimitBucketCount()).toBe(RATE_LIMIT_MAX_KEYS);

    expect(consumeRateLimit("ip-0")).toBe(true);
    expect(getRateLimitBucketCount()).toBe(RATE_LIMIT_MAX_KEYS);
  });
});

describe("runtimeEvents recordRuntimeEvent", () => {
  it("routes events to the DO shard when available and skips inline DB writes", async () => {
    const { env } = makeEnv({
      RUNTIME_EVENT_SHARD: {
        idFromName: vi.fn((name: any) => name),
        get: vi.fn(() => ({
          fetch: vi.fn(async (_url: string, init: RequestInit) => {
            const parsed = JSON.parse(String(init.body));
            expect(parsed.event).toBe("capsule.runtime");
            expect(parsed.id).toBeTruthy();
            return new Response(JSON.stringify({ ok: true, buffered: 1 }), {
              status: 202,
              headers: { "content-type": "application/json" },
            });
          }),
        })),
      } as any,
    });
    const req = new Request("https://worker.test/api/runtime-events", {
      method: "POST",
      body: JSON.stringify({ event: "capsule.runtime", capsuleId: "cap-do" }),
    });

    const res = await recordRuntimeEvent(req, env, noopCtx, noopParams);
    expect(res.status).toBe(202);
    expect((env.DB as any).prepare).not.toHaveBeenCalled();
  });

  it("still persists inline when runtime event DO is in shadow mode", async () => {
    const { env, boundValues } = makeEnv({
      RUNTIME_EVENT_DO_MODE: "shadow",
      RUNTIME_EVENT_SHARD: {
        idFromName: vi.fn((name: any) => name),
        get: vi.fn(() => ({
          fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 })),
        })),
      } as any,
    });
    const req = new Request("https://worker.test/api/runtime-events", {
      method: "POST",
      body: JSON.stringify({ event: "capsule.runtime", capsuleId: "cap-shadow" }),
    });

    const res = await recordRuntimeEvent(req, env, noopCtx, noopParams);
    expect(res.status).toBe(202);
    expect(boundValues.length).toBe(1);
  });

  it("rejects payloads that declare a body larger than the cap", async () => {
    const { env } = makeEnv();
    const req = new Request("https://worker.test/api/runtime-events", {
      method: "POST",
      headers: {
        "content-length": String(RUNTIME_EVENT_MAX_BYTES + 1),
        "content-type": "application/json",
      },
      body: JSON.stringify({ event: "oversized", message: "noop" }),
    });

    const res = await recordRuntimeEvent(req, env, noopCtx, noopParams);
    expect(res.status).toBe(413);
    const payload = (await res.json()) as { error: string; maxBytes: number };
    expect(payload.error).toBe("Payload too large");
    expect(payload.maxBytes).toBe(RUNTIME_EVENT_MAX_BYTES);
  });

  it("rejects streamed payloads that exceed the cap even without a declared content-length", async () => {
    const { env } = makeEnv();
    const oversizedMessage = "x".repeat(RUNTIME_EVENT_MAX_BYTES + 1024);
    const req = new Request("https://worker.test/api/runtime-events", {
      method: "POST",
      body: JSON.stringify({ event: "oversize", message: oversizedMessage }),
    });

    const res = await recordRuntimeEvent(req, env, noopCtx, noopParams);
    expect(res.status).toBe(413);
    const payload = (await res.json()) as { error: string; code?: string };
    expect(payload.error).toBe("Payload too large");
    expect(payload.code).toBe("E-VIBECODR-2133");
  });

  it("truncates oversized properties before storing the event", async () => {
    const { env, boundValues } = makeEnv();
    const largeValue = "z".repeat(RUNTIME_EVENT_PROPERTIES_MAX_BYTES + 2048);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = new Request("https://worker.test/api/runtime-events", {
      method: "POST",
      body: JSON.stringify({
        event: "capsule.upload",
        properties: { bundle: largeValue, extra: "ok" },
      }),
    });

    try {
      const res = await recordRuntimeEvent(req, env, noopCtx, noopParams);
      expect(res.status).toBe(202);

      expect(boundValues.length).toBe(1);
      const persistedProperties = boundValues[0][8];
      const parsed = JSON.parse(persistedProperties);
      expect(parsed.truncated).toBe(true);
      expect(parsed.totalBytes).toBeGreaterThan(RUNTIME_EVENT_PROPERTIES_MAX_BYTES);
      const encodedLength = new TextEncoder().encode(persistedProperties).byteLength;
      expect(encodedLength).toBeLessThanOrEqual(RUNTIME_EVENT_PROPERTIES_MAX_BYTES);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects timestamps outside the allowed clock skew window", async () => {
    const { env } = makeEnv();
    const futureSkewMs = RUNTIME_EVENT_MAX_CLOCK_SKEW_MS + 60 * 1000;
    const req = new Request("https://worker.test/api/runtime-events", {
      method: "POST",
      body: JSON.stringify({
        event: "capsule.runtime",
        timestamp: Date.now() + futureSkewMs,
      }),
    });

    const res = await recordRuntimeEvent(req, env, noopCtx, noopParams);
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { code?: string };
    expect(payload.code).toBe("E-VIBECODR-2135");
    expect(env.DB.prepare).not.toHaveBeenCalled();
    expect(env.vibecodr_analytics_engine.writeDataPoint).not.toHaveBeenCalled();
  });

  it("uses validated timestamps when persisting and emitting analytics doubles", async () => {
    const { env, boundValues } = makeEnv();
    const now = 1_000_000;
    vi.setSystemTime(now);

    const withinWindow = now - RUNTIME_EVENT_MAX_CLOCK_SKEW_MS + 1_500;
    const req = new Request("https://worker.test/api/runtime-events", {
      method: "POST",
      body: JSON.stringify({
        event: "capsule.runtime",
        timestamp: withinWindow,
      }),
    });

    const res = await recordRuntimeEvent(req, env, noopCtx, noopParams);
    expect(res.status).toBe(202);
    expect(boundValues[0]?.[9]).toBe(Math.floor(withinWindow / 1000));
    expect(env.vibecodr_analytics_engine.writeDataPoint).toHaveBeenCalledTimes(1);
    expect(env.vibecodr_analytics_engine.writeDataPoint).toHaveBeenCalledWith({
      blobs: ["capsule.runtime", "", "", "", "", "", ""],
      doubles: [withinWindow, 0],
      indexes: [""],
    });
  });

  it("returns 500 when the runtime event write fails so callers can retry", async () => {
    const { env, boundValues } = makeEnv();
    const runError = new Error("d1 unavailable");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prepareMock = env.DB.prepare as unknown as ReturnType<typeof vi.fn>;
    prepareMock.mockReturnValue({
      bind: (...args: any[]) => {
        boundValues.push(args);
        return { run: vi.fn().mockRejectedValue(runError) };
      },
    });

    const req = new Request("https://worker.test/api/runtime-events", {
      method: "POST",
      body: JSON.stringify({ event: "runtime.crash", capsuleId: "cap-1" }),
    });

    try {
      const res = await recordRuntimeEvent(req, env, noopCtx, noopParams);

      expect(res.status).toBe(500);
      const payload = (await res.json()) as { error: string; code: string; retryable?: boolean };
      expect(payload.code).toBe(ERROR_RUNTIME_ANALYTICS_FAILED);
      expect(payload.retryable).toBe(true);
      expect(env.vibecodr_analytics_engine.writeDataPoint).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("buildRuntimeAnalyticsSummary", () => {
  const makeSummaryEnv = (prepare: ReturnType<typeof vi.fn>): Env => ({
    DB: { prepare } as unknown as D1Database,
    R2: {} as any,
    vibecodr_analytics_engine: { writeDataPoint: vi.fn() } as any,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "test-issuer",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    RATE_LIMIT_SHARD: {} as any,
  });

  it("returns aggregated metrics for admin dashboards", async () => {
    const prepareResponses = [
      { results: [{ event_name: "runtime_error", total: 5, last_hour: 2, last_day: 5 }] }, // summary
      {
        results: [
          {
            event_name: "runtime_error",
            capsule_id: "caps-1",
            artifact_id: "art-1",
            runtime_type: "react-jsx",
            runtime_version: "v0.1.0",
            code: "E-VIBECODR-2101",
            message: "boom",
            properties: '{"status":"failed"}',
            created_at: 123,
          },
        ],
      }, // recent
      { results: [{ event_name: "runtime_error", errors: 5 }] }, // errorsLastDay
      { results: [{ capsule_id: "caps-1", total: 10, errors: 4, error_rate: 0.4 }] }, // capsuleErrorRates
      { results: [{ capsule_id: "caps-1", total_runs: 6, completed_runs: 5, failed_runs: 1 }] }, // run volumes
      { results: [{ killed: 2, completed: 8 }] }, // runtime outcomes
      { results: [{ total: 3, five_xx: 1 }] }, // artifacts health
      { results: [{ total: 5, five_xx: 2 }] }, // runs health
      { results: [{ total: 1, five_xx: 0 }] }, // import health
    ];

    const prepare = vi.fn((_sql: string) => {
      const next = prepareResponses.shift() ?? { results: [] };
      return {
        bind: (..._args: any[]) => ({
          all: vi.fn().mockResolvedValue(next),
        }),
      };
    });

    const env = makeSummaryEnv(prepare);
    const snapshot = await buildRuntimeAnalyticsSummary(env, { limit: 10, recentLimit: 5, nowMs: 1_000_000 });

    expect(snapshot.snapshotTime).toBe(1_000_000);
    expect(snapshot.summary[0]).toMatchObject({ eventName: "runtime_error", total: 5, lastHour: 2, lastDay: 5 });
    expect(snapshot.recent[0]).toMatchObject({ capsuleId: "caps-1", code: "E-VIBECODR-2101" });
    expect(snapshot.errorsLastDay).toEqual([{ eventName: "runtime_error", count: 5 }]);
    expect(snapshot.capsuleErrorRates[0]).toMatchObject({ capsuleId: "caps-1", errors: 4, total: 10, errorRate: 0.4 });
    expect(snapshot.capsuleRunVolumes[0]).toMatchObject({ totalRuns: 6, completedRuns: 5, failedRuns: 1 });
    expect(snapshot.health.runtime).toMatchObject({ killed: 2, completed: 8 });
    expect(snapshot.health.runtime.killRate).toBeCloseTo(0.2);
    expect(snapshot.health.endpoints.runs.rate).toBeCloseTo(0.4);
    expect(snapshot.health.endpoints.artifacts.rate).toBeCloseTo(1 / 3);
    expect(snapshot.health.endpoints["import"].rate).toBe(0);
    expect(prepare).toHaveBeenCalledTimes(9);
  });
});
