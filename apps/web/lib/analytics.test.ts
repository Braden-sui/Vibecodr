import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_RUNTIME_ANALYTICS_FAILED } from "@vibecodr/shared";
import { sendAnalytics } from "./analytics";

vi.mock("@/lib/api", () => ({
  workerUrl: (path: string) => `https://worker.test${path}`,
}));

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

describe("analytics runtime event retries", () => {
  beforeEach(() => {
    if (typeof originalWindow === "undefined") {
      (globalThis as any).window = {} as Window;
    }
  });

  afterEach(() => {
    if (typeof originalWindow === "undefined") {
      // CLEAN: remove the temporary window shim
      delete (globalThis as any).window;
    }
    globalThis.fetch = originalFetch as typeof fetch;
    vi.restoreAllMocks();
  });

  it("retries once when runtime event persistence returns a retryable 500", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retryable: true, code: ERROR_RUNTIME_ANALYTICS_FAILED }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    globalThis.fetch = fetchMock as typeof fetch;

    await sendAnalytics({ event: "runtime_error", capsuleId: "cap-1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the response omits the retryable signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ retryable: false }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );

    globalThis.fetch = fetchMock as typeof fetch;

    await sendAnalytics({ event: "runtime_error", capsuleId: "cap-2" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
