const CONTENT_TYPES: Record<string, string> = {
  html: "text/html",
  js: "application/javascript",
  css: "text/css",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  wasm: "application/wasm",
};

export function guessContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  return (ext && CONTENT_TYPES[ext]) || "application/octet-stream";
}
