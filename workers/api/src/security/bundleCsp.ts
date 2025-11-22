export type BundleNetworkMode = "offline" | "allow-https";

export function normalizeBundleNetworkMode(raw?: string | null): BundleNetworkMode {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return normalized === "allow-https" ? "allow-https" : "offline";
}

export function buildBundleCsp(mode: BundleNetworkMode): string {
  const base =
    "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;";
  const connect = mode === "allow-https" ? " connect-src 'self' https:;" : " connect-src 'none';";
  return `${base}${connect}`;
}
