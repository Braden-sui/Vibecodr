import { describe, it, expect } from "vitest";
import { compileReactArtifact } from "./compileReactArtifact";

function makeCode(lines: string[]): string {
  return lines.join("\n");
}

describe("compileReactArtifact", () => {
  it("rejects empty source", () => {
    const result = compileReactArtifact({ code: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1100");
    }
  });

  it("rejects when size exceeds maxBytes", () => {
    const code = "export default function A() { return null; }";
    const result = compileReactArtifact({ code, maxBytes: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1110");
      expect(result.details).toBeDefined();
    }
  });

  it("accepts allowed imports", () => {
    const code = makeCode([
      "import React from 'react';",
      "import ReactDOM from 'react-dom';",
      "import { ActivityIcon } from 'lucide-react';",
      "export default function RuntimeArtifact() { return null; }",
    ]);

    const result = compileReactArtifact({ code, maxBytes: 1024 * 1024 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toContain("RuntimeArtifact");
    }
  });

  it("rejects unsupported bare imports", () => {
    const code = makeCode([
      "import fs from 'fs';",
      "export default function RuntimeArtifact() { return null; }",
    ]);

    const result = compileReactArtifact({ code });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1103");
      expect(result.details).toBeDefined();
    }
  });

  it("allows relative imports without checking allowlist", () => {
    const code = makeCode([
      "import React from 'react';",
      "import Component from './Component';",
      "export default function RuntimeArtifact() { return React.createElement(Component); }",
    ]);

    const result = compileReactArtifact({ code });
    expect(result.ok).toBe(true);
  });

  it("rejects unsupported require calls", () => {
    const code = makeCode([
      "const fs = require('fs');",
      "export default function RuntimeArtifact() { return null; }",
    ]);

    const result = compileReactArtifact({ code });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1103");
    }
  });
});
