/// <reference types="vitest" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../index";
import {
  RATE_LIMIT_MAX_KEYS,
  consumeRateLimit,
  getClientIp,
  getRateLimitBucketCount,
  recordRuntimeEvent,
  RUNTIME_EVENT_MAX_BYTES,
  RUNTIME_EVENT_MAX_CLOCK_SKEW_MS,
  RUNTIME_EVENT_PROPERTIES_MAX_BYTES,
  resetAnalyticsRateLimitState,
} from "./runtimeEvents";
import { ERROR_RUNTIME_ANALYTICS_FAILED } from "@vibecodr/shared";

const makeEnv = () => {
  const boundValues: any[][] = [];
  const env = {
    DB: {
      prepare: vi.fn(() => ({
        bind: (...args: any[]) => {
          boundValues.push(args);
          return { run: vi.fn().mockResolvedValue(undefined) };
        },
      })),
    },
    R2: {} as any,
    vibecodr_analytics_engine: {
      writeDataPoint: vi.fn(),
    } as any,
    ALLOWLIST_HOSTS: "[]",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
  } as Env;

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
