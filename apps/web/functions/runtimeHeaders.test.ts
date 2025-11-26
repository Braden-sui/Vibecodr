import { describe, expect, it } from "vitest";
import { applyRuntimeHeaders, shouldApplyRuntimeHeaders } from "./runtimeHeaders";

describe("runtimeHeaders", () => {
  it("applies self-only frame ancestors on player pages", async () => {
    const request = new Request("https://vibecodr.space/player/post-123");
    const response = new Response("<html></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

    const secured = applyRuntimeHeaders(response, request);

    expect(shouldApplyRuntimeHeaders(request, response)).toBe(true);
    expect(secured.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    expect(secured.headers.get("Permissions-Policy")).toBeNull();
    expect(secured.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
    expect(secured.headers.get("Content-Security-Policy")).toMatch(/script-src[^;]*'nonce-[^';]+'/);
    expect(secured.headers.get("Content-Security-Policy")).not.toContain("unsafe-inline");
  });

  it("skips non-runtime assets", () => {
    const request = new Request("https://vibecodr.space/assets/app.js");
    const response = new Response("{}", { headers: { "content-type": "application/javascript" } });

    expect(shouldApplyRuntimeHeaders(request, response)).toBe(false);
  });

  it("does not rewrite non-runtime html routes", () => {
    const request = new Request("https://vibecodr.space/post/123");
    const response = new Response("<html></html>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "frame-ancestors 'none'",
      },
    });

    const secured = applyRuntimeHeaders(response, request);

    expect(shouldApplyRuntimeHeaders(request, response)).toBe(false);
    expect(secured.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
  });

  it("allows embeds to be framed broadly while keeping COEP off", () => {
    const request = new Request("https://vibecodr.space/e/post-123");
    const response = new Response("<html></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

    const secured = applyRuntimeHeaders(response, request);

    expect(secured.headers.get("Content-Security-Policy")).toContain("frame-ancestors *");
    expect(secured.headers.get("Cross-Origin-Embedder-Policy")).toBeNull();
  });
});
