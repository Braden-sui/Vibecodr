import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import { artifactsApi, capsulesApi } from "@/lib/api";
import { trackRuntimeEvent } from "@/lib/analytics";
import { PlayerIframe, RUNTIME_EVENT_LIMIT, RUNTIME_LOG_LIMIT } from "../Player/PlayerIframe";

vi.mock("@/lib/analytics", () => ({
  trackRuntimeEvent: vi.fn(),
  trackEvent: vi.fn(),
  trackClientError: vi.fn(),
}));

const originalFetch = global.fetch;
const baseRuntimeManifest = {
  artifactId: "artifact1",
  type: "react-jsx",
  runtimeVersion: "v0.1.0",
  version: 1,
  manifest: {
    artifactId: "artifact1",
    type: "react-jsx",
    runtime: {
      version: "v0.1.0",
      assets: {
        bridge: { path: "/runtime-assets/v0.1.0/bridge.js" },
        guard: { path: "/runtime-assets/v0.1.0/guard.js" },
        runtimeScript: { path: "/runtime-assets/v0.1.0/react-runtime.js" },
      },
    },
    bundle: {
      r2Key: "artifacts/artifact1/bundle.js",
      sizeBytes: 1024,
      digest: "digest",
    },
  },
};

function stubRuntimeManifestFetch(overrides?: Partial<typeof baseRuntimeManifest>) {
  const payload = { ...baseRuntimeManifest, ...(overrides || {}) };
  global.fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as any;
}

describe("PlayerIframe", () => {
  let originalHiddenDescriptor: PropertyDescriptor | undefined;
  let originalContentWindowDescriptor: PropertyDescriptor | undefined;
  const trackRuntimeEventMock = vi.mocked(trackRuntimeEvent);

  beforeAll(() => {
    originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    originalContentWindowDescriptor = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      "contentWindow"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, "hidden", originalHiddenDescriptor);
    }
    if (originalContentWindowDescriptor) {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", originalContentWindowDescriptor);
    }
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as any).fetch;
    }
  });

  afterAll(() => {
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, "hidden", originalHiddenDescriptor);
    }
    if (originalContentWindowDescriptor) {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", originalContentWindowDescriptor);
    }
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as any).fetch;
    }
  });

  it("pauses when tab is hidden and resumes when visible again after ready", () => {
    const postMessage = vi.fn();
    const runnerOrigin = new URL(capsulesApi.bundleSrc("capsule1")).origin;
    const contentWindow = { postMessage } as any;

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindow;
      },
    });

    render(<PlayerIframe capsuleId="capsule1" />);

    // Simulate the iframe reporting that it is ready
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "ready", payload: {} },
          origin: runnerOrigin,
          source: contentWindow,
        })
      );
    });

    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(postMessage).toHaveBeenCalledWith({ type: "pause" }, runnerOrigin);

    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(postMessage).toHaveBeenCalledWith({ type: "resume" }, runnerOrigin);
  });

  it("routes control messages to sandboxed null-origin runtimes", () => {
    stubRuntimeManifestFetch();
    const postMessage = vi.fn();
    const contentWindow = { postMessage } as any;

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindow;
      },
    });

    render(<PlayerIframe capsuleId="capsule1" artifactId="artifact1" />);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "ready", payload: {} },
          origin: "null",
          source: contentWindow,
        })
      );
    });

    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(postMessage).toHaveBeenCalledWith({ type: "pause" }, "null");
  });

  it("notifies parent when runtime posts an error message", () => {
    const onError = vi.fn();
    const runnerOrigin = new URL(capsulesApi.bundleSrc("capsule1")).origin;
    const contentWindow = {} as Window;

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindow as any;
      },
    });

    render(<PlayerIframe capsuleId="capsule1" onError={onError} />);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "error", payload: { message: "runtime exploded" } },
          origin: runnerOrigin,
          source: contentWindow,
        })
      );
    });

    expect(onError).toHaveBeenCalledWith("runtime exploded");
  });

  it("caps runtime logs per session and drops extras", () => {
    const onLog = vi.fn();
    const runnerOrigin = new URL(capsulesApi.bundleSrc("capsule1")).origin;
    const contentWindow = {} as Window;

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindow as any;
      },
    });

    render(<PlayerIframe capsuleId="capsule1" onLog={onLog} />);

    for (let i = 0; i < RUNTIME_LOG_LIMIT + 5; i += 1) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "log", payload: { level: "info", message: `log-${i}`, timestamp: i } },
            origin: runnerOrigin,
            source: contentWindow,
          })
        );
      });
    }

    expect(onLog).toHaveBeenCalledTimes(RUNTIME_LOG_LIMIT);
    const cappedCall = trackRuntimeEventMock.mock.calls.find(([eventName]) => eventName === "runtime_logs_capped");
    expect(cappedCall?.[1]).toMatchObject({ capsuleId: "capsule1", cappedAt: RUNTIME_LOG_LIMIT });
  });

  it("ignores non-null origins for artifact runtimes and fetches manifest", async () => {
    stubRuntimeManifestFetch();
    const runnerOrigin = new URL(artifactsApi.bundleSrc("artifact1")).origin;
    const onReady = vi.fn();
    const postMessage = vi.fn();
    const contentWindow = { postMessage } as any;

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindow as any;
      },
    });

    render(<PlayerIframe capsuleId="capsule1" artifactId="artifact1" onReady={onReady} />);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "ready", payload: {} },
          origin: runnerOrigin,
          source: contentWindow,
        })
      );
    });

    expect(onReady).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "ready", payload: {} },
          origin: "null",
          source: contentWindow,
        })
      );
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("caps runtime events after the limit is reached", () => {
    const runnerOrigin = new URL(capsulesApi.bundleSrc("capsule1")).origin;
    const contentWindow = {} as Window;

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindow as any;
      },
    });

    render(<PlayerIframe capsuleId="capsule1" />);

    for (let i = 0; i < RUNTIME_EVENT_LIMIT + 10; i += 1) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "error", payload: { message: `runtime failed ${i}` } },
            origin: runnerOrigin,
            source: contentWindow,
          })
        );
      });
    }

    const cappedCall = trackRuntimeEventMock.mock.calls.find(([eventName]) => eventName === "runtime_events_capped");
    expect(cappedCall).toBeDefined();
    expect(trackRuntimeEventMock).toHaveBeenCalledTimes(RUNTIME_EVENT_LIMIT + 1);
  });
});
