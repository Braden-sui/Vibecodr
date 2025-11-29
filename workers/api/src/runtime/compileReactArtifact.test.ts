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

  it("accepts any npm package imports (dynamic import map)", async () => {
    // WHY: We now allow ANY npm package - the sandbox is the security boundary.
    // All bare imports are resolved via esm.sh at runtime.
    const code = makeCode([
      "import React from 'react';",
      "import { format } from 'date-fns';",
      "import _ from 'lodash';",
      "import { create } from 'zustand';",
      "export default function RuntimeArtifact() { return React.createElement('div'); }",
    ]);

    const result = await compileReactArtifact({ code, maxBytes: 1024 * 1024 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Verify imports are extracted for dynamic import map
      expect(result.imports).toContain("react");
      expect(result.imports).toContain("date-fns");
      expect(result.imports).toContain("lodash");
      expect(result.imports).toContain("zustand");
    }
  });

  it("rejects Node.js builtin imports", async () => {
    const code = makeCode([
      "import fs from 'fs';",
      "export default function RuntimeArtifact() { return null; }",
    ]);

    const result = await compileReactArtifact({ code });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("E-VIBECODR-1103");
      expect(result.message).toContain("Node.js");
      expect(result.details?.imports).toContain("fs");
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

  it("rejects Node.js builtins inside additional files", async () => {
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

  it("allows Node.js imports for webcontainer runtime", async () => {
    // WHY: WebContainer is a Node.js-like VM environment for paying customers.
    // It should allow Node.js imports that would be blocked in browser sandbox.
    const code = makeCode([
      "import fs from 'fs';",
      "import path from 'path';",
      "export default function NodeApp() { return fs.existsSync(path.join('.')); }",
    ]);

    const result = await compileReactArtifact({
      code,
      runnerType: "webcontainer",
    });

    // Should compile successfully - Node.js imports allowed in webcontainer
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Node.js imports should be in the imports list
      expect(result.imports).toContain("fs");
      expect(result.imports).toContain("path");
    }
  });

  it("allows Node.js imports for worker-edge runtime", async () => {
    const code = makeCode([
      "import crypto from 'crypto';",
      "export default function EdgeWorker() { return crypto.randomUUID(); }",
    ]);

    const result = await compileReactArtifact({
      code,
      runnerType: "worker-edge",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.imports).toContain("crypto");
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
