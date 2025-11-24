import securityHeaders from "../securityHeaders";

const RUNTIME_PAGE_PATHS = [/^\/player(?:\/|$)/, /^\/e(?:\/|$)/];

function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") || "";
  return contentType.toLowerCase().includes("text/html");
}

function isRuntimePage(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return RUNTIME_PAGE_PATHS.some((pattern) => pattern.test(pathname));
}

export function shouldApplyRuntimeHeaders(request: Request, response: Response): boolean {
  return isHtmlResponse(response) && isRuntimePage(request);
}

export function applyRuntimeHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const headerSet = securityHeaders.buildSecurityHeaders({
    allowEmbedding: true,
    frameAncestors: "*",
    crossOriginEmbedderPolicy: null,
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
