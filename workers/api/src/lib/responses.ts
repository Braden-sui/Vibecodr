export function json(data: unknown, status = 200, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(data), { status, ...init, headers });
}
