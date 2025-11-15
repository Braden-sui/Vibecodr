// HTML artifact sanitize/compile helper for iframe runtime loader
// 2.4: HTML sanitize pipeline (server-side), script tag enforcement.

export interface HtmlCompileInput {
  html: string;
  maxBytes?: number;
}

export interface HtmlCompileResult {
  ok: true;
  html: string;
  warnings: string[];
}

export interface HtmlCompileError {
  ok: false;
  errorCode: string;
  message: string;
  details?: Record<string, unknown>;
}

export type HtmlCompileOutcome = HtmlCompileResult | HtmlCompileError;

const HTML_BASE_HREF = "https://runtime.vibecodr.com/html-base/";

// INVARIANT: Caller passes already-size-gated source when using plan-aware quotas.
export function compileHtmlArtifact(input: HtmlCompileInput): HtmlCompileOutcome {
  const source = typeof input.html === "string" ? input.html : "";
  const { maxBytes } = input;

  const trimmed = source.trim();
  if (!trimmed) {
    return {
      ok: false,
      errorCode: "E-VIBECODR-1100",
      message: "Artifact HTML is empty",
    };
  }

  const encoder = new TextEncoder();
  const size = encoder.encode(source).byteLength;
  if (typeof maxBytes === "number" && size > maxBytes) {
    return {
      ok: false,
      errorCode: "E-VIBECODR-1110",
      message: "Artifact HTML exceeds allowed size budget",
      details: { size, maxBytes },
    };
  }

  // Reject any <script> tags for now; external script allowlists can be added later.
  if (/<script\b/i.test(source)) {
    return {
      ok: false,
      errorCode: "E-VIBECODR-1100",
      message: "Script tags are not allowed in HTML artifacts",
      details: { reason: "script-tag" },
    };
  }

  let sanitized = stripInlineEventHandlers(source);
  const warnings: string[] = [];

  if (sanitized !== source) {
    warnings.push("Removed inline event handler attributes");
  }

  sanitized = ensureBaseHref(sanitized);
  sanitized = wrapBodyInContainer(sanitized);

  return {
    ok: true,
    html: sanitized,
    warnings,
  };
}

function stripInlineEventHandlers(input: string): string {
  // Remove attributes like onclick="..." or onload='...' on any element.
  return input.replace(/\son[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, "");
}

function ensureBaseHref(input: string): string {
  const baseTag = `<base href="${HTML_BASE_HREF}">`;

  // If a base href already exists, do not add another.
  if (/<base\b[^>]*href=/i.test(input)) {
    return input;
  }

  if (/<head[^>]*>/i.test(input)) {
    return input.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }

  return `${baseTag}${input}`;
}

function wrapBodyInContainer(input: string): string {
  if (/<body[^>]*>/i.test(input)) {
    let withOpen = input.replace(
      /<body([^>]*)>/i,
      '<body$1><div id="vibecodr-root">'
    );
    withOpen = withOpen.replace(/<\/body>/i, "</div></body>");
    return withOpen;
  }

  return `<div id="vibecodr-root">${input}</div>`;
}
