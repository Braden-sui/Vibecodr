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
});
