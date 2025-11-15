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

  it("adds base href into head when present", () => {
    const html = "<html><head><title>T</title></head><body>hi</body></html>";
    const result = compileHtmlArtifact({ html });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("<base href=\"https://runtime.vibecodr.com/html-base/\">");
    }
  });
});
