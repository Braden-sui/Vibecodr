export type RuntimeBundleNetworkMode = "offline" | "allow-https";

export function getRuntimeBundleNetworkMode(): RuntimeBundleNetworkMode {
  const raw = (process.env.NEXT_PUBLIC_RUNTIME_BUNDLE_NETWORK_MODE || "").trim().toLowerCase();
  return raw === "allow-https" ? "allow-https" : "offline";
}

export function runtimeNetworkAllowsHttps(): boolean {
  return getRuntimeBundleNetworkMode() === "allow-https";
}
