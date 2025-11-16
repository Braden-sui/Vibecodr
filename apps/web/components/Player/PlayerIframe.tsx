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
  artifactId?: string;
}

export interface PlayerIframeHandle {
  postMessage: (type: string, payload?: unknown) => boolean;
  restart: () => boolean;
  kill: () => boolean;
}

export const PlayerIframe = forwardRef<PlayerIframeHandle, PlayerIframeProps>(
  function PlayerIframe(
    { capsuleId, params = {}, onReady, onLog, onStats, onBoot, artifactId },
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

        const { type, payload } = event.data as { type?: string; payload?: any };

        switch (type) {
          case "ready": {
            setStatus("ready");
            const bootTime =
              payload && typeof payload.bootTime === "number" ? payload.bootTime : undefined;
            if (bootTime != null) {
              onBoot?.({ bootTimeMs: bootTime });
            }
            onReady?.();
            break;
          }

          case "log":
            onLog?.(payload);
            break;

          case "stats":
            onStats?.(payload);
            break;

          case "error":
            setStatus("error");
            setErrorMessage(payload.message || "An error occurred");
            break;
        }
      };

      window.addEventListener("message", handleMessage);

      return () => {
        window.removeEventListener("message", handleMessage);
      };
    }, [onReady, onLog, onStats, onBoot]);

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
