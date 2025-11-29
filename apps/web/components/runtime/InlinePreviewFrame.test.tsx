import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { InlinePreviewFrame } from "./InlinePreviewFrame";

describe("InlinePreviewFrame", () => {
  it("renders an iframe with sandbox attributes", () => {
    const { getByTitle } = render(
      <InlinePreviewFrame code="" title="test-preview" />
    );

    const iframe = getByTitle("test-preview");
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("shows placeholder message when code is empty", () => {
    const { getByTitle } = render(
      <InlinePreviewFrame code="" title="empty-preview" />
    );

    const iframe = getByTitle("empty-preview");
    const srcdoc = iframe.getAttribute("srcdoc") || "";
    expect(srcdoc).toContain("Start typing to see a preview");
  });

  it("includes Babel and import map when code is provided", () => {
    const code = `export default function App() { return <h1>Hello</h1>; }`;
    const { getByTitle } = render(
      <InlinePreviewFrame code={code} title="code-preview" />
    );

    const iframe = getByTitle("code-preview");
    const srcdoc = iframe.getAttribute("srcdoc") || "";
    
    // Should include Babel for transpilation
    expect(srcdoc).toContain("babel.min.js");
    
    // Should include import map for esm.sh
    expect(srcdoc).toContain("importmap");
    expect(srcdoc).toContain("https://esm.sh/react");
    expect(srcdoc).toContain("https://esm.sh/react-dom");
  });

  it("extracts npm packages from imports and adds to import map", () => {
    const code = `
      import { format } from 'date-fns';
      import _ from 'lodash';
      export default function App() { return <h1>{format(new Date(), 'yyyy')}</h1>; }
    `;
    const { getByTitle } = render(
      <InlinePreviewFrame code={code} title="imports-preview" />
    );

    const iframe = getByTitle("imports-preview");
    const srcdoc = iframe.getAttribute("srcdoc") || "";
    
    // Should include discovered packages in import map
    expect(srcdoc).toContain("https://esm.sh/date-fns");
    expect(srcdoc).toContain("https://esm.sh/lodash");
  });

  it("handles scoped packages correctly", () => {
    const code = `
      import { Button } from '@radix-ui/react-button';
      export default function App() { return <Button>Click</Button>; }
    `;
    const { getByTitle } = render(
      <InlinePreviewFrame code={code} title="scoped-preview" />
    );

    const iframe = getByTitle("scoped-preview");
    const srcdoc = iframe.getAttribute("srcdoc") || "";
    
    expect(srcdoc).toContain("https://esm.sh/@radix-ui/react-button");
  });

  it("ignores relative imports in import map", () => {
    const code = `
      import { helper } from './utils';
      import stuff from '../shared/stuff';
      export default function App() { return <h1>Hello</h1>; }
    `;
    const { getByTitle } = render(
      <InlinePreviewFrame code={code} title="relative-preview" />
    );

    const iframe = getByTitle("relative-preview");
    const srcdoc = iframe.getAttribute("srcdoc") || "";
    
    // Extract just the import map section
    const importMapMatch = srcdoc.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/);
    expect(importMapMatch).toBeTruthy();
    const importMapContent = importMapMatch![1];
    
    // Relative imports should NOT be in the import map (only react/react-dom)
    expect(importMapContent).not.toContain("./utils");
    expect(importMapContent).not.toContain("../shared");
    expect(importMapContent).toContain("react");
    expect(importMapContent).toContain("react-dom");
  });

  it("fires onReady when preview sends ready message", async () => {
    const onReady = vi.fn();
    const code = `export default function App() { return <h1>Hello</h1>; }`;
    
    const { getByTitle } = render(
      <InlinePreviewFrame code={code} title="ready-preview" onReady={onReady} />
    );

    const iframe = getByTitle("ready-preview") as HTMLIFrameElement;

    // Simulate postMessage from iframe
    const readyEvent = new MessageEvent("message", {
      data: {
        source: "vibecodr-inline-preview",
        type: "ready",
        payload: { hasComponent: true },
      },
      source: iframe.contentWindow,
    });
    window.dispatchEvent(readyEvent);

    await waitFor(() => {
      expect(onReady).toHaveBeenCalled();
    });
  });

  it("fires onError when preview sends error message", async () => {
    const onError = vi.fn();
    const code = `this is not valid code`;
    
    const { getByTitle } = render(
      <InlinePreviewFrame code={code} title="error-preview" onError={onError} />
    );

    const iframe = getByTitle("error-preview") as HTMLIFrameElement;

    // Simulate error postMessage from iframe
    const errorEvent = new MessageEvent("message", {
      data: {
        source: "vibecodr-inline-preview",
        type: "error",
        payload: { message: "Syntax error" },
      },
      source: iframe.contentWindow,
    });
    window.dispatchEvent(errorEvent);

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Syntax error");
    });
  });

  it("includes CSP that allows esm.sh and unpkg", () => {
    const code = `export default function App() { return <h1>Hello</h1>; }`;
    const { getByTitle } = render(
      <InlinePreviewFrame code={code} title="csp-preview" />
    );

    const iframe = getByTitle("csp-preview");
    const srcdoc = iframe.getAttribute("srcdoc") || "";
    
    // CSP should allow esm.sh and unpkg for scripts and connect
    expect(srcdoc).toContain("Content-Security-Policy");
    expect(srcdoc).toContain("https://esm.sh");
    expect(srcdoc).toContain("https://unpkg.com");
  });

  it("includes extra packages in import map", () => {
    const code = `export default function App() { return <h1>Hello</h1>; }`;
    const { getByTitle } = render(
      <InlinePreviewFrame
        code={code}
        title="extra-packages-preview"
        extraPackages={["three", "framer-motion"]}
      />
    );

    const iframe = getByTitle("extra-packages-preview");
    const srcdoc = iframe.getAttribute("srcdoc") || "";
    
    expect(srcdoc).toContain("https://esm.sh/three");
    expect(srcdoc).toContain("https://esm.sh/framer-motion");
  });
});
