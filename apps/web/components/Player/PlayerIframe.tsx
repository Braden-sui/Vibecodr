"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Loader2 } from "lucide-react";
import { artifactsApi, capsulesApi } from "@/lib/api";
import { trackRuntimeEvent } from "@/lib/analytics";
import { getRuntimeErrorInfo } from "@/lib/runtime/errorMessages";
import type { RunnerType } from "@vibecodr/shared/manifest";
import type { PolicyViolationEvent } from "@/lib/runtime/types";
import { getRuntimeBundleNetworkMode } from "@/lib/runtime/networkMode";
import { RUNTIME_IFRAME_PERMISSIONS, RUNTIME_IFRAME_SANDBOX } from "@/lib/runtime/sandboxPolicies";
import { RUNTIME_TELEMETRY_LIMIT, type RuntimeEvent } from "@/lib/runtime/runtimeSession";
import { useRuntimeSession } from "@/lib/runtime/useRuntimeSession";

export const RUNTIME_EVENT_LIMIT = RUNTIME_TELEMETRY_LIMIT;
export const RUNTIME_LOG_LIMIT = 200;

export interface PlayerIframeProps {
  capsuleId: string;
  runnerType?: RunnerType;
  params?: Record<string, unknown>;
  onReady?: () => void;
  onLoading?: () => void;
  onLog?: (log: { level: string; message: string; timestamp?: number }) => void;
  onStats?: (stats: { fps: number; memory: number }) => void;
  onBoot?: (metrics: { bootTimeMs: number }) => void;
  onError?: (message: string) => void;
  /** Called when runtimeSession boot timeout fires. Parent should handle budget violation. */
  onBootTimeout?: (durationMs: number) => void;
  /** Called when runtimeSession run timeout fires. Parent should handle budget violation. */
  onRunTimeout?: (durationMs: number) => void;
  artifactId?: string;
}

export interface PlayerIframeHandle {
  postMessage: (type: string, payload?: unknown) => boolean;
  restart: () => boolean;
  kill: () => boolean;
}

type RuntimeLogPayload = { level: string; message: string; timestamp?: number };
type RuntimeStatsPayload = { fps: number; memory: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getBootTime(payload: unknown): number | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload.bootTime;
  return typeof value === "number" ? value : undefined;
}

function isRuntimeLogPayload(payload: unknown): payload is RuntimeLogPayload {
  if (!isRecord(payload)) return false;
  return typeof payload.level === "string" && typeof payload.message === "string";
}

function isRuntimeStatsPayload(payload: unknown): payload is RuntimeStatsPayload {
  if (!isRecord(payload)) return false;
  return typeof payload.fps === "number" && typeof payload.memory === "number";
}

function getErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  return typeof payload.message === "string" ? payload.message : undefined;
}

function getPolicyViolationDetails(payload: unknown) {
  if (!isRecord(payload)) {
    return { message: "Policy violation detected", code: undefined };
  }
  const message =
    typeof payload.message === "string" ? payload.message : "Policy violation detected";
  const code = typeof payload.code === "string" ? payload.code : undefined;
  return { message, code };
}

function toOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function resolveRunnerOrigins(bundleUrl: string | null | undefined, includeNullOrigin: boolean): string[] {
  const origins = new Set<string>();
  const bundleOrigin = toOrigin(bundleUrl);

  if (includeNullOrigin) {
    origins.add("null");
  } else if (bundleOrigin) {
    origins.add(bundleOrigin);
  }

  return Array.from(origins);
}

export const PlayerIframe = forwardRef<PlayerIframeHandle, PlayerIframeProps>(
  function PlayerIframe(
    {
      capsuleId,
      runnerType,
      params = {},
      onReady,
      onLoading,
      onLog,
      onStats,
      onBoot,
      onError,
      onBootTimeout,
      onRunTimeout,
      artifactId,
    },
    ref
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [errorMessage, setErrorMessage] = useState<string>("");
    const pauseStateRef = useRef<"paused" | "running">("running");
    const bundleUrl = useMemo(
      () => (artifactId ? artifactsApi.bundleSrc(artifactId) : capsulesApi.bundleSrc(capsuleId)),
      [artifactId, capsuleId]
    );
    const runnerOrigins = useMemo(
      () => resolveRunnerOrigins(bundleUrl, Boolean(artifactId)),
      [artifactId, bundleUrl]
    );
    const heartbeatTrackedRef = useRef(false);
    const runtimeLogCountRef = useRef(0);
    const runtimeLogLimitHitRef = useRef(false);
    const bootStartedAtRef = useRef<number | null>(null);
    const paramsRef = useRef(params);
    useEffect(() => {
      paramsRef.current = params;
    }, [params]);
    useEffect(() => {
      if (status === "loading") {
        onLoading?.();
      }
    }, [onLoading, status]);
    const resetRuntimeCounters = useCallback(() => {
      runtimeLogCountRef.current = 0;
      runtimeLogLimitHitRef.current = false;
      heartbeatTrackedRef.current = false;
      bootStartedAtRef.current = null;
    }, []);
    useEffect(() => {
      resetRuntimeCounters();
    }, [artifactId, capsuleId, resetRuntimeCounters]);

    const postOrigins = useMemo(() => {
      // INVARIANT: only allow explicit runtime origins; sandboxed runtimes use the null origin.
      return runnerOrigins.filter((origin): origin is string => Boolean(origin));
    }, [runnerOrigins]);

    // INVARIANT: These handlers use emitRuntimeEventRef to avoid re-registering effects
    // when the telemetry emitter changes.
    const handleSandboxReady = useCallback(() => {
      emitRuntimeEventRef.current("runtime_frame_loaded");
    }, []);

    const handleSandboxError = useCallback(
      (message: string) => {
        emitRuntimeEventRef.current("runtime_frame_error", {
          message,
        });
        setStatus("error");
        setErrorMessage(message);
        onError?.(message);
      },
      [onError]
    );

    const handlePolicyViolation = useCallback(
      (violation: PolicyViolationEvent) => {
        setStatus("error");
        setErrorMessage(violation.message);
        onError?.(violation.message);
        emitRuntimeEventRef.current("runtime_policy_violation", {
          message: violation.message,
          code: violation.code,
        });
      },
      [onError]
    );

    const runtimeSessionLogger = useCallback(
      (event: RuntimeEvent) => {
        trackRuntimeEvent("runtime_session_event", {
          surface: "player",
          capsuleId,
          artifactId: artifactId ?? null,
          eventType: event.type,
          status: event.type === "state" ? event.status : undefined,
          error: event.type === "state" ? event.error ?? null : undefined,
          durationMs: "durationMs" in event ? event.durationMs : undefined,
        });
      },
      [artifactId, capsuleId]
    );

    const { runtimeFrame, state: runtimeSessionState, session } = useRuntimeSession({
      artifactId: artifactId ?? "",
      capsuleId,
      bundleUrl,
      params: paramsRef.current,
      runnerType,
      surface: "player",
      autoStart: Boolean(artifactId),
      className: "h-full w-full border-0",
      title: "Vibe Runner",
      frameRef: iframeRef,
      onReady: handleSandboxReady,
      onError: handleSandboxError,
      onPolicyViolation: handlePolicyViolation,
      onBootTimeout,
      onRunTimeout,
      logger: runtimeSessionLogger,
    });

    const emitRuntimeEvent = useCallback(
      (event: string, payload?: Record<string, unknown>) => {
        session.emitTelemetry(event, payload);
      },
      [session]
    );

    // WHY: Store emitRuntimeEvent in a ref so handlers stay stable inside effects.
    const emitRuntimeEventRef = useRef(emitRuntimeEvent);
    useEffect(() => {
      emitRuntimeEventRef.current = emitRuntimeEvent;
    }, [emitRuntimeEvent]);

    useEffect(() => {
      if (runtimeSessionState.status === "loading") {
        bootStartedAtRef.current = Date.now();
      }
    }, [runtimeSessionState.status]);

    useEffect(() => {
      if (runtimeSessionState.status === "loading") {
        setStatus("loading");
        setErrorMessage("");
        onLoading?.();
      } else if (runtimeSessionState.status === "error") {
        const message =
          runtimeSessionState.error || "We couldn't load this app. Please try again.";
        setStatus("error");
        setErrorMessage(message);
        emitRuntimeEventRef.current("runtime_manifest_error", {
          error: message,
        });
        onError?.(message);
      }
    }, [
      onError,
      onLoading,
      runtimeSessionState.error,
      runtimeSessionState.status,
    ]);

    const sendToIframe = useCallback(
      (type: string, payload?: unknown) => {
        const iframe = iframeRef.current;
        const target = iframe?.contentWindow;
        if (!target || postOrigins.length === 0) {
          if (postOrigins.length === 0) {
            console.warn("E-VIBECODR-0520 runner origin allowlist empty; skipping postMessage", {
              capsuleId,
              type,
            });
          }
          return false;
        }

        const message =
          payload === undefined
            ? { type }
            : {
                type,
                payload,
              };

        for (const origin of postOrigins) {
          // WHY: Sandboxed iframes without allow-same-origin have a null origin.
          // postMessage() requires "*" to target null-origin windows; the string
          // "null" is not valid and throws SyntaxError.
          target.postMessage(message, origin === "null" ? "*" : origin);
        }

        return true;
      },
      [capsuleId, postOrigins]
    );

    useImperativeHandle(
      ref,
      () => ({
        postMessage: (type: string, payload?: unknown) => sendToIframe(type, payload),
        restart: () => {
          resetRuntimeCounters();
          const sent = sendToIframe("restart");
          if (!sent) {
            const iframe = iframeRef.current;
            if (iframe) {
              iframe.src = bundleUrl;
            }
          }
          setStatus("loading");
          setErrorMessage("");
          pauseStateRef.current = "running";
          return sent;
        },
        kill: () => {
          resetRuntimeCounters();
          const sent = sendToIframe("kill");
          if (!sent) {
            const iframe = iframeRef.current;
            if (iframe) {
              iframe.src = "about:blank";
            }
          }
          pauseStateRef.current = "paused";
          return sent;
        },
      }),
      [bundleUrl, resetRuntimeCounters, sendToIframe]
    );

    useEffect(() => {
      if (!iframeRef.current) return;

      let warnedMissingRunnerOrigin = false;

      // Listen for messages from the iframe
      const handleMessage = (event: MessageEvent) => {
        const iframeWindow = iframeRef.current?.contentWindow;
        if (!iframeWindow || event.source !== iframeWindow) {
          return;
        }

        if (runnerOrigins.length === 0) {
          if (!warnedMissingRunnerOrigin) {
            console.warn(
              "E-VIBECODR-0521 runner origin allowlist empty; dropping incoming message",
              { capsuleId }
            );
            warnedMissingRunnerOrigin = true;
          }
          return;
        }

        if (!runnerOrigins.includes(event.origin)) {
          return;
        }

        const message = event.data;
        if (!isRecord(message)) {
          return;
        }
        const type = typeof message.type === "string" ? message.type : undefined;
        if (!type) {
          return;
        }
        const payload = message.payload;
        const currentArtifactId = runtimeSessionState.manifest?.artifactId ?? artifactId ?? null;

        switch (type) {
          case "ready": {
            setStatus("ready");
            const bootTime = getBootTime(payload);
            const actualBootTime = bootStartedAtRef.current
              ? Date.now() - bootStartedAtRef.current
              : bootTime;
            if (bootTime != null) {
              onBoot?.({ bootTimeMs: bootTime });
            }
            onReady?.();
            emitRuntimeEvent("runtime_ready", {
              bootTime: bootTime ?? null,
              actualBootTime: actualBootTime ?? null,
            });
            break;
          }

          case "heartbeat": {
            if (!heartbeatTrackedRef.current) {
              heartbeatTrackedRef.current = true;
              emitRuntimeEvent("runtime_heartbeat");
            }
            break;
          }

          case "log":
            if (isRuntimeLogPayload(payload)) {
              if (runtimeLogCountRef.current >= RUNTIME_LOG_LIMIT) {
                if (!runtimeLogLimitHitRef.current) {
                  runtimeLogLimitHitRef.current = true;
                  console.warn("E-VIBECODR-0525 runtime logs capped for this session", {
                    capsuleId,
                    artifactId: currentArtifactId,
                    cappedAt: RUNTIME_LOG_LIMIT,
                  });
                  emitRuntimeEvent("runtime_logs_capped", {
                    cappedAt: RUNTIME_LOG_LIMIT,
                  });
                }
                break;
              }
              runtimeLogCountRef.current += 1;
              onLog?.(payload);
            }
            break;

          case "stats":
            if (isRuntimeStatsPayload(payload)) {
              onStats?.(payload);
            }
            break;

          case "error": {
            const message = getErrorMessage(payload) ?? "An error occurred";
            setStatus("error");
            setErrorMessage(message);
            onError?.(message);
            emitRuntimeEvent("runtime_error", {
              message,
              code: (isRecord(payload) && typeof payload.code === "string" ? payload.code : undefined) ?? undefined,
            });
            break;
          }

          case "policyViolation": {
            const { message: violationMessage, code } = getPolicyViolationDetails(payload);
            setStatus("error");
            setErrorMessage(violationMessage);
            onError?.(violationMessage);
            emitRuntimeEvent("runtime_policy_violation", {
              message: violationMessage,
              code,
            });
            break;
          }

          // SOTP Decision: Handle capability check results from sandboxed iframe
          case "capabilityCheck": {
            if (isRecord(payload)) {
              const available = Array.isArray(payload.available) ? payload.available : [];
              const unavailable = Array.isArray(payload.unavailable) ? payload.unavailable : [];
              const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];

              // Log capability check results for debugging/monitoring
              emitRuntimeEvent("runtime_capability_check", {
                available,
                unavailable,
                warnings,
              });

              // Security warning: if parentOriginAccess is available, sandbox may be misconfigured
              if (available.includes("parentOriginAccess")) {
                console.error("E-VIBECODR-0527 SECURITY WARNING: sandbox misconfiguration detected", {
                  capsuleId,
                  artifactId: currentArtifactId,
                  warnings,
                  message: "Capsule has access to parent origin - sandbox may not be properly configured",
                });
                emitRuntimeEvent("runtime_security_warning", {
                  type: "sandbox_misconfiguration",
                  message: "Parent origin accessible from sandboxed iframe",
                });
              }
            }
            break;
          }
        }
      };

      window.addEventListener("message", handleMessage);

      return () => {
        window.removeEventListener("message", handleMessage);
      };
    }, [
      capsuleId,
      emitRuntimeEvent,
      artifactId,
      onBoot,
      onError,
      onLog,
      onReady,
      onStats,
      runtimeSessionState.manifest,
      runnerOrigins,
    ]);

    // Send params to iframe when they change
    useEffect(() => {
      if (status === "ready") {
        sendToIframe("setParams", params);
      }
    }, [params, status, sendToIframe]);

    // WHY: Store onError in a ref to avoid it causing effect re-runs when parent re-renders.
    const onErrorRef = useRef(onError);
    useEffect(() => {
      onErrorRef.current = onError;
    }, [onError]);

    useEffect(() => {
      const onVisibility = () => {
        if (status !== "ready") {
          return;
        }

        const shouldPause = document.hidden;
        const nextState: "paused" | "running" = shouldPause ? "paused" : "running";
        if (nextState === pauseStateRef.current) {
          return;
        }

        const sent = sendToIframe(nextState === "paused" ? "pause" : "resume");
        if (!sent) {
          return;
        }
        pauseStateRef.current = nextState;
      };

      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }, [sendToIframe, status]);

    const runtimeNetworkMode = getRuntimeBundleNetworkMode();
    const runtimeRender =
      runtimeFrame ??
      (artifactId ? (
        <iframe
          ref={iframeRef}
          src="about:blank"
          data-capsule-id={capsuleId}
          data-runtime-network-mode={runtimeNetworkMode}
          className="h-full w-full border-0"
          sandbox={RUNTIME_IFRAME_SANDBOX}
          allow={RUNTIME_IFRAME_PERMISSIONS}
          referrerPolicy="no-referrer"
          title="Vibe Runner"
        />
      ) : (
        <iframe
          ref={iframeRef}
          src={bundleUrl}
          data-capsule-id={capsuleId}
          data-runtime-network-mode={runtimeNetworkMode}
          className="h-full w-full border-0"
          sandbox={RUNTIME_IFRAME_SANDBOX}
          allow={RUNTIME_IFRAME_PERMISSIONS}
          referrerPolicy="no-referrer"
          title="Vibe Runner"
        />
      ));

    return (
      <div className="relative h-full w-full overflow-hidden rounded-lg border bg-background">
        {/* Loading State */}
        {status === "loading" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">Loading vibe...</p>
          </div>
        )}

        {/* Error State */}
        {status === "error" && (() => {
          const errorInfo = getRuntimeErrorInfo(errorMessage);
          return (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 p-8 backdrop-blur-sm">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <h3 className="mt-4 text-lg font-semibold">{errorInfo.title}</h3>
              <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
                {errorInfo.message}
              </p>
              {errorInfo.suggestion && (
                <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground/70">
                  {errorInfo.suggestion}
                </p>
              )}
              <Badge variant="destructive" className="mt-4">
                Error
              </Badge>
            </div>
          );
        })()}

        {/* Sandboxed Iframe */}
        {runtimeRender}
      </div>
    );
  }
);
