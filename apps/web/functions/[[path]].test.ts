import { describe, it, expect, vi, beforeEach } from "vitest";
import { onRequest } from "./[[path]]";
import * as runtimeHeaders from "./runtimeHeaders";

describe("[[path]] runtime header integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("applies runtime security headers for player HTML responses", async () => {
    const request = new Request("https://vibecodr.space/player/abc");
    const nextResponse = new Response("<html></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const next = vi.fn().mockResolvedValue(nextResponse);

    const applySpy = vi.spyOn(runtimeHeaders, "applyRuntimeHeaders");
    const shouldSpy = vi.spyOn(runtimeHeaders, "shouldApplyRuntimeHeaders");

    const response = await onRequest({ request, next });

    expect(next).toHaveBeenCalledTimes(1);
    expect(shouldSpy).toHaveBeenCalledWith(request, nextResponse);
    expect(applySpy).toHaveBeenCalledWith(nextResponse, request);
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors");
    expect(response.headers.get("Permissions-Policy")).toBeNull();
  });

  it("returns the untouched response for non-runtime assets", async () => {
    const request = new Request("https://vibecodr.space/assets/app.js");
    const nextResponse = new Response("console.log('hi')", {
      headers: { "content-type": "application/javascript" },
    });
    const next = vi.fn().mockResolvedValue(nextResponse);
    const applySpy = vi.spyOn(runtimeHeaders, "applyRuntimeHeaders");

    const response = await onRequest({ request, next });

    expect(next).toHaveBeenCalledTimes(1);
    expect(response).toBe(nextResponse);
    expect(applySpy).not.toHaveBeenCalled();
  });
});
