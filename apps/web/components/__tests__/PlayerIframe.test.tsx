import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { act } from "react-dom/test-utils";
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

    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return {
          postMessage,
        } as any;
      },
    });

    render(<PlayerIframe capsuleId="capsule1" />);

    // Simulate the iframe reporting that it is ready
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "ready", payload: {} },
        })
      );
    });

    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(postMessage).toHaveBeenCalledWith({ type: "pause" }, "*");

    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(postMessage).toHaveBeenCalledWith({ type: "resume" }, "*");
  });

  it("notifies parent when runtime posts an error message", () => {
    const onError = vi.fn();

    render(<PlayerIframe capsuleId="capsule1" onError={onError} />);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "error", payload: { message: "runtime exploded" } },
        })
      );
    });

    expect(onError).toHaveBeenCalledWith("runtime exploded");
  });
});
