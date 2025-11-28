import { describe, it, expect } from "vitest";
import { compileReactArtifact } from "./compileReactArtifact";

function makeCode(lines: string[]): string {
  return lines.join("\n");
}

describe("compileReactArtifact", () => {
  it("rejects empty source", async () => {
    const result = await compileReactArtifact({ code: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1100");
    }
  });

  it("rejects when size exceeds maxBytes", async () => {
    const code = "export default function A() { return null; }";
    const result = await compileReactArtifact({ code, maxBytes: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1110");
      expect(result.details).toBeDefined();
    }
  });

  it("rejects when additionalFiles push size over maxBytes", async () => {
    const code = "export default function A() { return null; }";
    const result = await compileReactArtifact({
      code,
      maxBytes: 128,
      additionalFiles: {
        "helper.ts": "export const big = '" + "x".repeat(1024) + "';",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1110");
      expect(result.details?.size).toBeGreaterThan(128);
    }
  });

  it("accepts allowed imports", async () => {
    const code = makeCode([
      "import React from 'react';",
      "import ReactDOM from 'react-dom';",
      "import { ActivityIcon } from 'lucide-react';",
      "export default function RuntimeArtifact() { return null; }",
    ]);

    const result = await compileReactArtifact({ code, maxBytes: 1024 * 1024 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toContain("return null");
    }
  });

  it("rejects unsupported bare imports", async () => {
    const code = makeCode([
      "import fs from 'fs';",
      "export default function RuntimeArtifact() { return null; }",
    ]);

    const result = await compileReactArtifact({ code });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1103");
      expect(result.details).toBeDefined();
    }
  });

  it("allows relative imports inside additional files when modules are allowed", async () => {
    const code = makeCode([
      "import React from 'react';",
      "import Component from './Component';",
      "export default function RuntimeArtifact() { return React.createElement(Component); }",
    ]);

    const result = await compileReactArtifact({
      code,
      additionalFiles: {
        "Component.tsx": "export default function Component() { return null; }",
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unsupported bare imports inside additional files", async () => {
    const code = makeCode([
      "import Helper from './helper';",
      "export default function RuntimeArtifact() { return Helper; }",
    ]);

    const result = await compileReactArtifact({
      code,
      additionalFiles: {
        "helper.ts": "import fs from 'fs'; export default fs;",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1103");
      expect(result.details?.imports).toContain("fs");
    }
  });

  it("rejects unsupported require calls", async () => {
    const code = makeCode([
      "const fs = require('fs');",
      "export default function RuntimeArtifact() { return null; }",
    ]);

    const result = await compileReactArtifact({ code });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1103");
    }
  });

  it("bundles React source and tree-shakes unused exports", async () => {
    const code = makeCode([
      "import { foo } from './foo.js';",
      "console.log(foo);",
    ]);
    const result = await compileReactArtifact({
      code: `${code}\nexport const foo = 42;`,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toContain("console.log");
      expect(result.code).toContain("42");
      expect(result.code).not.toContain("foo = 42");
    }
  });

  it("compiles JSX with only named React imports (no default import)", async () => {
    // WHY: Users often use named imports without 'import React from react'.
    // The automatic JSX transform should handle this correctly.
    const code = makeCode([
      "import { useState, useEffect } from 'react';",
      "",
      "export default function Counter() {",
      "  const [count, setCount] = useState(0);",
      "  useEffect(() => { console.log('mounted'); }, []);",
      "  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;",
      "}",
    ]);

    const result = await compileReactArtifact({ code, maxBytes: 1024 * 1024 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The bundled output should work without 'React' being explicitly imported
      expect(result.code).toContain("useState");
      expect(result.code).toContain("useEffect");
    }
  });
});
