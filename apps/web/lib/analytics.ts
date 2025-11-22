"use client";

import { workerUrl } from "@/lib/api";
import { ERROR_RUNTIME_ANALYTICS_FAILED } from "@vibecodr/shared";

export type AnalyticsProps = Record<string, unknown>;

type AnalyticsPayload = AnalyticsProps & {
  event: string;
  capsuleId?: string | null;
  artifactId?: string | null;
  runtimeType?: string | null;
  runtimeVersion?: string | null;
  message?: string | null;
  code?: string | null;
  timestamp?: number;
};

const ANALYTICS_MAX_RETRIES = 1;

type RuntimeEventResponse = {
  code?: string;
  retryable?: boolean;
};

function logDebug(message: string, meta: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.debug(message, meta);
  }
}

async function shouldRetry(response: Response): Promise<boolean> {
  if (response.status < 500) return false;

  try {
    const payload = (await response.clone().json()) as RuntimeEventResponse;
    return Boolean(payload?.retryable && payload.code === ERROR_RUNTIME_ANALYTICS_FAILED);
  } catch {
    return false;
  }
}

async function postRuntimeEvent(body: string, eventName: string, attempt = 0): Promise<void> {
  try {
    const response = await fetch(workerUrl("/runtime-events"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
      body,
    });

    if (response.ok) return;

    const retryable = await shouldRetry(response);
    if (retryable && attempt < ANALYTICS_MAX_RETRIES) {
      return postRuntimeEvent(body, eventName, attempt + 1);
    }

    logDebug("[analytics] runtime event post failed", { eventName, status: response.status, retryable });
  } catch (error) {
    if (attempt < ANALYTICS_MAX_RETRIES) {
      return postRuntimeEvent(body, eventName, attempt + 1);
    }

    logDebug("[analytics] runtime event post errored", {
      eventName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendAnalytics(payload: AnalyticsPayload): Promise<void> {
  if (typeof window === "undefined") return;

  const eventPayload = {
    ...payload,
    timestamp: payload.timestamp ?? Date.now(),
  };
  const body = JSON.stringify(eventPayload);

  await postRuntimeEvent(body, eventPayload.event);
}

export function trackEvent(event: string, properties?: AnalyticsProps) {
  void sendAnalytics({
    event,
    ...(properties ?? {}),
  });
}

export function trackClientError(code: string, properties?: AnalyticsProps) {
  void sendAnalytics({
    event: "client_error",
    code,
    type: "client_error",
    ...(properties ?? {}),
  });
}

type RuntimeAnalyticsPayload = Omit<AnalyticsPayload, "event">;

export function trackRuntimeEvent(event: string, payload?: RuntimeAnalyticsPayload) {
  void sendAnalytics({
    event,
    ...(payload ?? {}),
  });
}
