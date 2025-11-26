const DEFAULT_REMOTE_BASE = "https://vibecodr-api.braden-yig.workers.dev";
const DEFAULT_LOCAL_BASE = "http://127.0.0.1:8787";

function normalizeBaseUrl(value?: string | null) {
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

// WHY: Runtime/API base defaults to workers.dev unless env overrides supply a custom domain.
// INVARIANT: Only use an alternate base when env vars explicitly provide it.
export function getWorkerApiBase() {
  const envBases = [
    process.env.WORKER_API_BASE,
    process.env.NEXT_PUBLIC_API_BASE,
    process.env.NEXT_PUBLIC_API_URL,
  ];

  for (const candidate of envBases) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }

  return process.env.NODE_ENV === "production" ? DEFAULT_REMOTE_BASE : DEFAULT_LOCAL_BASE;
}
