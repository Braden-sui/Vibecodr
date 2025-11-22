import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import { useReducedMotion } from "../useReducedMotion";

function TestComponent() {
  const prefers = useReducedMotion();
  return <div data-testid="prefers">{prefers ? "true" : "false"}</div>;
}

describe("useReducedMotion", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("defaults to true when matchMedia is unavailable", () => {
    // @ts-expect-error intentional unset for test
    window.matchMedia = undefined;
    render(<TestComponent />);
    expect(screen.getByTestId("prefers").textContent).toBe("true");
  });

  it("reflects media query match state and reacts to changes", () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    let mediaMatches = false;
    const mockMedia = {
      get matches() {
        return mediaMatches;
      },
      addEventListener: vi.fn((_event: string, cb: (event: MediaQueryListEvent) => void) => {
        listeners.push(cb);
      }),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;

    window.matchMedia = vi.fn(() => mockMedia);

    render(<TestComponent />);
    expect(screen.getByTestId("prefers").textContent).toBe("false");

    act(() => {
      mediaMatches = true;
      listeners.forEach((cb) => cb({ matches: true } as MediaQueryListEvent));
    });

    expect(screen.getByTestId("prefers").textContent).toBe("true");
  });
});
