import { describe, it, expect } from "vitest";

// Basic smoke tests to ensure runtime asset bundles can be imported in jsdom
// and that they register the expected globals on window.

declare global {
  interface Window {
    vibecodrBridge?: unknown;
    VibecodrReactRuntime?: unknown;
    VibecodrHtmlRuntime?: unknown;
  }
}

describe("runtime assets bundle v0.1.0", () => {
  it("registers vibecodrBridge on window", async () => {
    await import("../runtime-assets/v0.1.0/bridge.js");
    expect(window.vibecodrBridge).toBeDefined();
  });

  it("registers React and HTML runtime globals", async () => {
    await import("../runtime-assets/v0.1.0/react-runtime.js");
    await import("../runtime-assets/v0.1.0/html-runtime.js");

    expect(window.VibecodrReactRuntime).toBeDefined();
    expect(window.VibecodrHtmlRuntime).toBeDefined();
  });
});
