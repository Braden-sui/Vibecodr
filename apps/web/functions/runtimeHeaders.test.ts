import { describe, expect, it } from "vitest";
import { applyRuntimeHeaders, shouldApplyRuntimeHeaders } from "./runtimeHeaders";

describe("runtimeHeaders", () => {
  it("applies strict headers to runtime player pages", async () => {
    const request = new Request("https://vibecodr.space/player/post-123");
    const response = new Response("<html></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

    const secured = applyRuntimeHeaders(response);

    expect(shouldApplyRuntimeHeaders(request, response)).toBe(true);
    expect(secured.headers.get("Content-Security-Policy")).toContain("frame-ancestors *");
    expect(secured.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(secured.headers.get("Cross-Origin-Embedder-Policy")).toBeNull();
  });

  it("skips non-runtime assets", () => {
    const request = new Request("https://vibecodr.space/assets/app.js");
    const response = new Response("{}", { headers: { "content-type": "application/javascript" } });

    expect(shouldApplyRuntimeHeaders(request, response)).toBe(false);
  });
});
