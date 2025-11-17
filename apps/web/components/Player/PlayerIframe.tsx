"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Loader2 } from "lucide-react";
import { capsulesApi } from "@/lib/api";
import { loadRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";

export interface PlayerIframeProps {
  capsuleId: string;
  params?: Record<string, unknown>;
  onReady?: () => void;
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

export const PlayerIframe = forwardRef<PlayerIframeHandle, PlayerIframeProps>(
  function PlayerIframe(
    { capsuleId, params = {}, onReady, onLog, onStats, onBoot, onError, artifactId },
    ref
  ) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [errorMessage, setErrorMessage] = useState<string>("");
    const pauseStateRef = useRef<"paused" | "running">("running");

    const sendToIframe = useCallback(
      (type: string, payload?: unknown) => {
        const iframe = iframeRef.current;
        const target = iframe?.contentWindow;
        if (!target) {
          return false;
        }

        const message =
          payload === undefined
            ? { type }
            : {
                type,
                payload,
              };

        target.postMessage(message, "*"); // TODO: Use explicit bundle origin
        return true;
      },
      []
    );

    useImperativeHandle(
      ref,
      () => ({
        postMessage: (type: string, payload?: unknown) => sendToIframe(type, payload),
        restart: () => {
          const sent = sendToIframe("restart");
          if (!sent) {
            const iframe = iframeRef.current;
            if (iframe) {
              iframe.src = capsulesApi.bundleSrc(capsuleId);
            }
            setStatus("loading");
            setErrorMessage("");
          }
          pauseStateRef.current = "running";
          return sent;
        },
        kill: () => {
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
      [capsuleId, sendToIframe]
    );

    useEffect(() => {
      if (!iframeRef.current) return;

      // Listen for messages from the iframe
      const handleMessage = (event: MessageEvent) => {
        // TODO: Verify origin matches our R2 domain
        // if (!event.origin.startsWith('https://capsules.vibecodr.space')) return;

        const message = event.data;
        if (!isRecord(message)) {
          return;
        }
        const type = typeof message.type === "string" ? message.type : undefined;
        if (!type) {
          return;
        }
        const payload = message.payload;

        switch (type) {
          case "ready": {
            setStatus("ready");
            const bootTime = getBootTime(payload);
            if (bootTime != null) {
              onBoot?.({ bootTimeMs: bootTime });
            }
            onReady?.();
            break;
          }

          case "log":
            if (isRuntimeLogPayload(payload)) {
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
            break;
          }
        }
      };

      window.addEventListener("message", handleMessage);

      return () => {
        window.removeEventListener("message", handleMessage);
      };
    }, [onReady, onLog, onStats, onBoot, onError]);

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

      if (!artifactId) {
        // No runtime artifact; rely on legacy capsule bundle path.
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
          await loadRuntimeManifest(artifactId);
          if (cancelled) return;
          // Successful manifest load; actual boot still happens via iframe src + bridge.
        } catch (err) {
          if (cancelled) return;
          console.error("[player] runtime manifest load failed", {
            artifactId,
            error: err instanceof Error ? err.message : String(err),
          });
          setStatus("error");
          setErrorMessage("Failed to load runtime manifest for this artifact.");
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [artifactId]);

    useEffect(() => {
      const onVisibility = () => {
        const target = iframeRef.current?.contentWindow;
        if (!target || status !== "ready") {
          return;
        }

        const shouldPause = document.hidden;
        const nextState: "paused" | "running" = shouldPause ? "paused" : "running";
        if (nextState === pauseStateRef.current) {
          return;
        }
        pauseStateRef.current = nextState;

        target.postMessage(
          {
            type: nextState === "paused" ? "pause" : "resume",
          },
          "*"
        );
      };

      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }, [status]);

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
        <iframe
          ref={iframeRef}
          src={capsulesApi.bundleSrc(capsuleId)}
          data-capsule-id={capsuleId}
          className="h-full w-full"
          sandbox="allow-scripts allow-same-origin"
          allow=""
          title="Vibe Runner"
          style={{
            border: "none",
            width: "100%",
            height: "100%",
          }}
        />
      </div>
    );
  }
);
