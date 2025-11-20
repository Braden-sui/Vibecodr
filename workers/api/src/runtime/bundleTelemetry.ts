import type { Env } from "../index";
import type { PublishWarning } from "../handlers/capsules";
import { ERROR_BUNDLE_WARNING_TELEMETRY_FAILED } from "@vibecodr/shared";

export function recordBundleWarningMetrics(
  env: Env,
  warnings: PublishWarning[] | undefined,
  source: string
): void {
  if (!warnings || warnings.length === 0) return;
  if (!env.vibecodr_analytics_engine) return;

  const bundleWarnings = warnings.filter((warning) => warning.path?.startsWith("bundle."));
  if (bundleWarnings.length === 0) return;

  try {
    env.vibecodr_analytics_engine.writeDataPoint({
      doubles: [bundleWarnings.length],
      indexes: [source],
    });
  } catch (error) {
    console.error(ERROR_BUNDLE_WARNING_TELEMETRY_FAILED, {
      source,
      warningCount: bundleWarnings.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
