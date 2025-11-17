import { describe, it, expect } from "vitest";
import { compileHtmlArtifact } from "./compileHtmlArtifact";

describe("compileHtmlArtifact", () => {
  it("rejects empty html", () => {
    const result = compileHtmlArtifact({ html: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1100");
    }
  });

  it("rejects when size exceeds maxBytes", () => {
    const html = "<html><body>hello</body></html>";
    const result = compileHtmlArtifact({ html, maxBytes: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1110");
      expect(result.details).toBeDefined();
    }
  });

  it("rejects html containing script tags", () => {
    const html = "<html><body><script>alert('x')</script></body></html>";
    const result = compileHtmlArtifact({ html });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1100");
    }
  });

  it("strips inline event handlers and wraps body in container", () => {
    const html = "<html><head></head><body><button onclick=\"doThing()\">Click</button></body></html>";
    const result = compileHtmlArtifact({ html });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).not.toContain("onclick=");
      expect(result.html).toContain("<div id=\"vibecodr-root\">");
    }
  });

  it("strips dangerous container tags like iframe, object, and embed", () => {
    const html =
      "<html><head></head><body>" +
      "<iframe src=\"https://evil.test\"></iframe>" +
      "<object data=\"data:text/html,some-html\"></object>" +
      "<embed src=\"data:text/html,some-html\"></embed>" +
      "</body></html>";

    const result = compileHtmlArtifact({ html });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html.toLowerCase()).not.toContain("<iframe");
      expect(result.html.toLowerCase()).not.toContain("<object");
      expect(result.html.toLowerCase()).not.toContain("<embed");
    }
  });

  it("removes javascript and data URI attributes from href and src", () => {
    const html =
      "<html><head></head><body>" +
      "<a href=\"javascript:alert(1)\">link</a>" +
      "<img src=\"javascript:alert(1)\" />" +
      "<img src=\"data:text/html,some-html\" />" +
      "</body></html>";

    const result = compileHtmlArtifact({ html });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html.toLowerCase()).not.toContain("javascript:");
      expect(result.html.toLowerCase()).not.toContain("data:text/html");
    }
  });

  it("adds base href into head when present", () => {
    const html = "<html><head><title>T</title></head><body>hi</body></html>";
    const result = compileHtmlArtifact({ html });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("<base href=\"https://runtime.vibecodr.com/html-base/\">");
    }
  });

  it("keeps safe style/link/meta tags but strips malicious variants", () => {
    const html = `
      <html>
        <head>
          <meta charset="utf-8">
          <meta http-equiv="refresh" content="0;url=https://evil.test">
          <link rel="stylesheet" href="/main.css">
          <link rel="prefetch" href="/prefetch.js">
          <style>
            body { color: red; background: url("javascript:alert(1)"); }
            @import url('javascript:alert(1)');
          </style>
        </head>
        <body>content</body>
      </html>
    `;

    const result = compileHtmlArtifact({ html });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html.toLowerCase()).toContain("<meta charset=\"utf-8\">");
      expect(result.html.toLowerCase()).not.toContain("http-equiv=\"refresh\"");
      expect(result.html).toContain("rel=\"stylesheet\"");
      expect(result.html).toContain("href=\"/main.css\"");
      expect(result.html).not.toContain("rel=\"prefetch\"");
      expect(result.html).toContain("<style>");
      expect(result.html).toMatch(/background:\s*url\(\);/);
      expect(result.html).not.toContain("@import url('javascript:alert(1)')");
    }
  });
});
