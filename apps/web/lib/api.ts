// Tiny API client placeholder. All endpoints are served by the Cloudflare Worker (workers/api).
// TODO: Add auth headers and error handling; consider TanStack Query for data.

export async function getLatestPosts() {
  // TODO: Replace with actual endpoint
  return [] as Array<{ id: string; type: "app" | "report"; title: string }>;
}

export async function getManifest(capsuleId: string) {
  // TODO: GET /capsules/:id/manifest
  return null as any;
}

