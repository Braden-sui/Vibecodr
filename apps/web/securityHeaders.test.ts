import { describe, it, expect } from "vitest";
import securityHeaders from "./securityHeaders";

describe("securityHeaders", () => {
  it("emits a worker-src directive that permits blob workers", () => {
    const headers = securityHeaders.buildSecurityHeaders();
    const cspHeader = headers.find((header) => header.key === "Content-Security-Policy");

    expect(cspHeader).toBeDefined();
    expect(cspHeader?.value).toContain("worker-src 'self' blob:");
  });

  it("omits unsupported directives from Permissions-Policy", () => {
    const headers = securityHeaders.buildSecurityHeaders();
    const permissionsPolicy = headers.find((header) => header.key === "Permissions-Policy");

    expect(permissionsPolicy).toBeDefined();
    expect(permissionsPolicy?.value).not.toContain("document-domain");
  });

  it("allows the worker API origin in connect-src", () => {
    const headers = securityHeaders.buildSecurityHeaders();
    const cspHeader = headers.find((header) => header.key === "Content-Security-Policy");

    expect(cspHeader).toBeDefined();
    expect(cspHeader?.value).toContain("https://vibecodr-api.braden-yig.workers.dev");
  });

  it("allows the Clerk accounts origin in connect-src", () => {
    const headers = securityHeaders.buildSecurityHeaders();
    const cspHeader = headers.find((header) => header.key === "Content-Security-Policy");

    expect(cspHeader).toBeDefined();
    expect(cspHeader?.value).toContain("https://accounts.vibecodr.space");
  });

  it("permits Clerk image CDN hosts in img-src", () => {
    const headers = securityHeaders.buildSecurityHeaders();
    const cspHeader = headers.find((header) => header.key === "Content-Security-Policy");

    expect(cspHeader).toBeDefined();
    expect(cspHeader?.value).toContain("img-src");
    expect(cspHeader?.value).toContain("https://img.clerk.com");
  });

  it("supports nonces and omits unsafe-inline", () => {
    const headers = securityHeaders.buildSecurityHeaders({ scriptNonce: "abc123", styleNonce: "def456" });
    const cspHeader = headers.find((header) => header.key === "Content-Security-Policy");

    expect(cspHeader).toBeDefined();
    expect(cspHeader?.value).toContain("'nonce-abc123'");
    expect(cspHeader?.value).toContain("'nonce-def456'");
    expect(cspHeader?.value).not.toContain("unsafe-inline");
  });
});
