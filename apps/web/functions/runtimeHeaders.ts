import securityHeaders from "../securityHeaders";

const PLAYER_PATH_PATTERN = /^\/player(?:\/|$)/;
const EMBED_PATH_PATTERN = /^\/e(?:\/|$)/;
const RUNTIME_PAGE_PATHS = [PLAYER_PATH_PATTERN, EMBED_PATH_PATTERN];

function generateNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") || "";
  return contentType.toLowerCase().includes("text/html");
}

function isRuntimePage(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return RUNTIME_PAGE_PATHS.some((pattern) => pattern.test(pathname));
}

function isRuntimePathname(pathname: string): boolean {
  return RUNTIME_PAGE_PATHS.some((pattern) => pattern.test(pathname));
}

export function shouldApplyRuntimeHeaders(request: Request, response: Response): boolean {
  return isHtmlResponse(response) && isRuntimePage(request);
}

export function applyRuntimeHeadersForPath(response: Response, pathname: string): Response {
  if (!isRuntimePathname(pathname)) {
    return response;
  }

  const headers = new Headers(response.headers);
  const allowEmbedding = EMBED_PATH_PATTERN.test(pathname);
  const frameAncestors = allowEmbedding ? "*" : "'self'";
  const scriptNonce = generateNonce();
  const styleNonce = scriptNonce;
  const headerSet = securityHeaders.buildSecurityHeaders({
    allowEmbedding,
    frameAncestors,
    crossOriginEmbedderPolicy: allowEmbedding ? null : undefined,
    scriptNonce,
    styleNonce,
  });

  for (const header of headerSet) {
    headers.set(header.key, header.value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function applyRuntimeHeaders(response: Response, request?: Request): Response {
  const pathname = request ? new URL(request.url).pathname : "/";
  return applyRuntimeHeadersForPath(response, pathname);
}
