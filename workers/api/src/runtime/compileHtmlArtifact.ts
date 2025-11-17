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

  let next = stripDangerousTags(sanitized);
  if (next !== sanitized) {
    warnings.push("Removed disallowed HTML containers or dangerous URI attributes");
  }
  sanitized = next;

  next = sanitizeLinkTags(sanitized);
  if (next !== sanitized) {
    warnings.push("Removed unsafe <link> tags");
  }
  sanitized = next;

  next = sanitizeMetaTags(sanitized);
  if (next !== sanitized) {
    warnings.push("Removed unsafe <meta> tags");
  }
  sanitized = next;

  next = sanitizeStyleTags(sanitized);
  if (next !== sanitized) {
    warnings.push("Sanitized <style> blocks");
  }
  sanitized = next;

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
  return input.replace(/\son[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function stripDangerousTags(input: string): string {
  const BLOCKED_TAGS = [
    "script",
    "iframe",
    "object",
    "embed",
    "applet",
    "base",
  ];

  let sanitized = input;
  for (const tag of BLOCKED_TAGS) {
    const openRegex = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    sanitized = sanitized.replace(openRegex, "");

    const closeRegex = new RegExp(`<\\/${tag}>`, "gi");
    sanitized = sanitized.replace(closeRegex, "");
  }

  sanitized = sanitized.replace(/\b(on\w+|href|src)\s*=\s*["']?(javascript|data):/gi, "");

  return sanitized;
}

function sanitizeLinkTags(input: string): string {
  const LINK_REGEX = /<link\b[^>]*>/gi;
  return input.replace(LINK_REGEX, (tag) => {
    const relValue = (getAttributeValue(tag, "rel") || "").toLowerCase();
    const relTokens = relValue.split(/\s+/).filter(Boolean);
    const hasStylesheetRel =
      relTokens.length === 0 || relTokens.includes("stylesheet");
    if (!hasStylesheetRel) {
      return "";
    }

    const hrefValue = getAttributeValue(tag, "href");
    if (!hrefValue || !hrefValue.trim()) {
      return "";
    }

    return tag;
  });
}

function sanitizeMetaTags(input: string): string {
  const META_REGEX = /<meta\b[^>]*>/gi;
  return input.replace(META_REGEX, (tag) => {
    const httpEquiv = getAttributeValue(tag, "http-equiv");
    if (httpEquiv && httpEquiv.toLowerCase() === "refresh") {
      return "";
    }
    return tag;
  });
}

function sanitizeStyleTags(input: string): string {
  const STYLE_REGEX = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
  return input.replace(STYLE_REGEX, (block) => sanitizeStyleBlock(block));
}

function sanitizeStyleBlock(block: string): string {
  const openTagMatch = block.match(/<style\b[^>]*>/i);
  if (!openTagMatch) {
    return block;
  }
  const openTag = openTagMatch[0];
  const cssStart = openTag.length;
  const closeIndex = block.toLowerCase().lastIndexOf("</style>");
  if (closeIndex === -1) {
    return block;
  }

  const css = block.slice(cssStart, closeIndex);
  const sanitizedCss = sanitizeCssContent(css);
  if (!sanitizedCss.trim()) {
    return "";
  }

  return `${openTag}${sanitizedCss}</style>`;
}

function sanitizeCssContent(css: string): string {
  let sanitized = removeDangerousImports(css);
  sanitized = neutralizeDangerousUrls(sanitized);
  sanitized = sanitized.replace(/expression\s*\(/gi, "/* expression removed */(");
  return sanitized;
}

function removeDangerousImports(css: string): string {
  return css.replace(/@import\s+[^;]+;?/gi, (statement) => {
    return /(javascript|data):/i.test(statement) ? "" : statement;
  });
}

function neutralizeDangerousUrls(css: string): string {
  let result = "";
  let cursor = 0;
  const lower = css.toLowerCase();

  while (cursor < css.length) {
    const urlIndex = lower.indexOf("url(", cursor);
    if (urlIndex === -1) {
      result += css.slice(cursor);
      break;
    }

    result += css.slice(cursor, urlIndex);

    let i = urlIndex + 4;
    let depth = 1;
    let quote: string | null = null;
    while (i < css.length) {
      const char = css[i];
      if (quote) {
        if (char === quote && css[i - 1] !== "\\") {
          quote = null;
        }
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }

    const segment = css.slice(urlIndex, i);
    if (/(javascript|data):/i.test(segment)) {
      result += "url()";
    } else {
      result += segment;
    }

    cursor = i;
  }

  return result;
}

function getAttributeValue(tag: string, attribute: string): string | null {
  const pattern = new RegExp(
    `${attribute}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const match = tag.match(pattern);
  if (!match) {
    return null;
  }

  return match[2] ?? match[3] ?? match[4] ?? null;
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
