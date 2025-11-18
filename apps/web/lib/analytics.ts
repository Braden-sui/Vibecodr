"use client";

import posthog from "posthog-js";

export type AnalyticsProps = Record<string, unknown>;

const isPosthogReady = () => {
  if (typeof window === "undefined") return false;
  return typeof posthog?.capture === "function";
};

export function trackEvent(event: string, properties?: AnalyticsProps) {
  if (!isPosthogReady()) return;

  try {
    posthog.capture(event, properties);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.debug("[analytics] Failed to capture event", event, error);
    }
  }
}

export function trackClientError(code: string, properties?: AnalyticsProps) {
  trackEvent("client_error", {
    type: "client_error",
    code,
    ...(properties ?? {}),
  });
}
