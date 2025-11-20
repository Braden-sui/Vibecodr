import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import { capsulesApi } from "@/lib/api";
import { PlayerIframe } from "../Player/PlayerIframe";

describe("PlayerIframe", () => {
  let originalHiddenDescriptor: PropertyDescriptor | undefined;
  let originalContentWindowDescriptor: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    originalContentWindowDescriptor = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype,
      "contentWindow"
    );
  });

  afterAll(() => {
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, "hidden", originalHiddenDescriptor);
    }
    if (originalContentWindowDescriptor) {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", originalContentWindowDescriptor);
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
    const postMessage = vi.fn();
    const contentWindow = { postMessage } as any;

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return contentWindow;
      },
    });

    render(<PlayerIframe capsuleId="capsule1" />);

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
});
