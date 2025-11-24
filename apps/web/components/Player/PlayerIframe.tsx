"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Loader2 } from "lucide-react";
import { artifactsApi, capsulesApi } from "@/lib/api";
import { trackRuntimeEvent } from "@/lib/analytics";
import { loadRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";
import { loadRuntime } from "@/lib/runtime/registry";
import type { ClientRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";
import type { PolicyViolationEvent } from "@/lib/runtime/types";
import { getRuntimeBundleNetworkMode } from "@/lib/runtime/networkMode";
import { RUNTIME_IFRAME_PERMISSIONS, RUNTIME_IFRAME_SANDBOX } from "@/lib/runtime/sandboxPolicies";

export const RUNTIME_EVENT_LIMIT = 120;
export const RUNTIME_LOG_LIMIT = 200;

export interface PlayerIframeProps {
  capsuleId: string;
  params?: Record<string, unknown>;
  onReady?: () => void;
  onLoading?: () => void;
  onLog?: (log: { level: string; message: string; timestamp?: number }) => void;
  onStats?: (stats: { fps: number; memory: number }) => void;
  onBoot?: (metrics: { bootTimeMs: number }) => void;
  onError?: (message: string) => void;
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
    { capsuleId, params = {}, onReady, onLoading, onLog, onStats, onBoot, onError, artifactId },
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
    const [runtimeManifest, setRuntimeManifest] = useState<ClientRuntimeManifest | null>(null);
    const [runtimeFrame, setRuntimeFrame] = useState<ReactElement | null>(null);
    const heartbeatTrackedRef = useRef(false);
    const runtimeEventCountRef = useRef(0);
    const runtimeEventLimitHitRef = useRef(false);
    const runtimeLogCountRef = useRef(0);
    const runtimeLogLimitHitRef = useRef(false);
    const paramsRef = useRef(params);
    useEffect(() => {
      paramsRef.current = params;
    }, [params]);
    useEffect(() => {
      if (status === "loading") {
        onLoading?.();
      }
    }, [onLoading, status]);
    const resetRuntimeBudgets = useCallback(() => {
      runtimeEventCountRef.current = 0;
      runtimeEventLimitHitRef.current = false;
      runtimeLogCountRef.current = 0;
      runtimeLogLimitHitRef.current = false;
      heartbeatTrackedRef.current = false;
    }, []);
    useEffect(() => {
      resetRuntimeBudgets();
    }, [artifactId, capsuleId, resetRuntimeBudgets]);
    const telemetryArtifactId = runtimeManifest?.artifactId ?? artifactId;
    const emitRuntimeEvent = useCallback(
      (event: string, payload?: Record<string, unknown>) => {
        if (runtimeEventCountRef.current >= RUNTIME_EVENT_LIMIT) {
          if (!runtimeEventLimitHitRef.current) {
            runtimeEventLimitHitRef.current = true;
            console.warn("E-VIBECODR-0524 runtime events capped for this session", {
              capsuleId,
              artifactId: telemetryArtifactId,
            });
            trackRuntimeEvent("runtime_events_capped", {
              capsuleId,
              artifactId: telemetryArtifactId,
            });
          }
          return;
        }

        runtimeEventCountRef.current += 1;
        trackRuntimeEvent(event, {
          capsuleId,
          artifactId: telemetryArtifactId,
          ...(payload ?? {}),
        });
      },
      [capsuleId, telemetryArtifactId]
    );
    const postOrigins = useMemo(() => {
      // INVARIANT: only allow explicit runtime origins; sandboxed runtimes use the null origin.
      return runnerOrigins.filter((origin): origin is string => Boolean(origin));
    }, [runnerOrigins]);
    const handleSandboxReady = useCallback(() => {
      emitRuntimeEvent("runtime_frame_loaded");
    }, [emitRuntimeEvent]);

    const handleSandboxError = useCallback(
      (message: string) => {
        emitRuntimeEvent("runtime_frame_error", {
          message,
        });
        setStatus("error");
        setErrorMessage(message);
        onError?.(message);
      },
      [emitRuntimeEvent, onError]
    );

    const handlePolicyViolation = useCallback(
      (violation: PolicyViolationEvent) => {
        setStatus("error");
        setErrorMessage(violation.message);
        onError?.(violation.message);
        emitRuntimeEvent("runtime_policy_violation", {
          message: violation.message,
          code: violation.code,
        });
      },
      [emitRuntimeEvent, onError]
    );

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
          target.postMessage(message, origin);
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
          resetRuntimeBudgets();
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
          resetRuntimeBudgets();
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
      [bundleUrl, resetRuntimeBudgets, sendToIframe]
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
        const telemetryBase = {
          capsuleId,
          artifactId: telemetryArtifactId,
        };

        switch (type) {
          case "ready": {
            setStatus("ready");
            const bootTime = getBootTime(payload);
            if (bootTime != null) {
              onBoot?.({ bootTimeMs: bootTime });
            }
            onReady?.();
            emitRuntimeEvent("runtime_ready", {
              ...telemetryBase,
              bootTime: bootTime ?? null,
            });
            break;
          }

          case "heartbeat": {
            if (!heartbeatTrackedRef.current) {
              heartbeatTrackedRef.current = true;
              emitRuntimeEvent("runtime_heartbeat", telemetryBase);
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
                    artifactId: telemetryArtifactId,
                    cappedAt: RUNTIME_LOG_LIMIT,
                  });
                  emitRuntimeEvent("runtime_logs_capped", {
                    ...telemetryBase,
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
              ...telemetryBase,
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
              ...telemetryBase,
              message: violationMessage,
              code,
            });
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
      onBoot,
      onError,
      onLog,
      onReady,
      onStats,
      runnerOrigins,
      telemetryArtifactId,
    ]);

    // Send params to iframe when they change
    useEffect(() => {
      if (status === "ready") {
        sendToIframe("setParams", params);
      }
    }, [params, status, sendToIframe]);

    // Load runtime manifest when an artifactId is provided. If it fails, surface an
    // error state before attempting to talk to the iframe runtime.
    useEffect(() => {
      let cancelled = false;
      heartbeatTrackedRef.current = false;
      setRuntimeManifest(null);
      setRuntimeFrame(null);

      if (!artifactId) {
        setStatus("loading");
        setErrorMessage("");
        return () => {
          cancelled = true;
        };
      }

      setStatus("loading");
      setErrorMessage("");

      (async () => {
        try {
          const manifest = await loadRuntimeManifest(artifactId);
          if (cancelled) return;
          setRuntimeManifest(manifest);
          emitRuntimeEvent("runtime_manifest_loaded", {
            capsuleId,
            artifactId: manifest.artifactId ?? artifactId,
            runtimeVersion: manifest.runtimeVersion,
            runtimeType: manifest.type,
            bundleDigest: manifest.bundle.digest,
            bundleSizeBytes: manifest.bundle.sizeBytes,
          });
        } catch (err) {
          if (cancelled) return;
          const errorMessageText = "Failed to load runtime manifest for this artifact.";
          console.error("[player] runtime manifest load failed", {
            artifactId,
            error: err instanceof Error ? err.message : String(err),
          });
          setStatus("error");
          setErrorMessage(errorMessageText);
          emitRuntimeEvent("runtime_manifest_error", {
            capsuleId,
            artifactId,
            error: err instanceof Error ? err.message : String(err),
          });
          onError?.(errorMessageText);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [artifactId, capsuleId, emitRuntimeEvent, onError]);

    useEffect(() => {
      if (!runtimeManifest) {
        setRuntimeFrame(null);
        return;
      }

      try {
        const element = loadRuntime(runtimeManifest.type, {
          manifest: runtimeManifest,
          bundleUrl,
          params: paramsRef.current,
          frameRef: iframeRef,
          title: "Vibecodr runtime",
          onReady: handleSandboxReady,
          onError: handleSandboxError,
          onPolicyViolation: handlePolicyViolation,
        });
        setRuntimeFrame(element);
      } catch (error) {
        const errorMessage = "Failed to initialize runtime.";
        console.error("E-VIBECODR-2108 runtime loader failed to render", {
          capsuleId,
          artifactId: runtimeManifest.artifactId,
          error: error instanceof Error ? error.message : String(error),
        });
        emitRuntimeEvent("runtime_loader_error", {
          capsuleId,
          artifactId: runtimeManifest.artifactId ?? artifactId,
          error: error instanceof Error ? error.message : String(error),
        });
        setStatus("error");
        setErrorMessage(errorMessage);
        setRuntimeFrame(null);
      }
    }, [
      runtimeManifest,
      bundleUrl,
      handleSandboxReady,
      handleSandboxError,
      handlePolicyViolation,
      emitRuntimeEvent,
      capsuleId,
      artifactId,
    ]);

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
          className="h-full w-full"
          sandbox={RUNTIME_IFRAME_SANDBOX}
          allow={RUNTIME_IFRAME_PERMISSIONS}
          referrerPolicy="no-referrer"
          title="Vibe Runner"
          style={{
            border: "none",
            width: "100%",
            height: "100%",
          }}
        />
      ) : (
        <iframe
          ref={iframeRef}
          src={bundleUrl}
          data-capsule-id={capsuleId}
          data-runtime-network-mode={runtimeNetworkMode}
          className="h-full w-full"
          sandbox={RUNTIME_IFRAME_SANDBOX}
          allow={RUNTIME_IFRAME_PERMISSIONS}
          referrerPolicy="no-referrer"
          title="Vibe Runner"
          style={{
            border: "none",
            width: "100%",
            height: "100%",
          }}
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
        {status === "error" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 p-8 backdrop-blur-sm">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <h3 className="mt-4 text-lg font-semibold">Failed to load vibe</h3>
            <p className="mt-2 text-center text-sm text-muted-foreground">{errorMessage}</p>
            <Badge variant="destructive" className="mt-4">
              Error
            </Badge>
          </div>
        )}

        {/* Sandboxed Iframe */}
        {runtimeRender}
      </div>
    );
  }
);
