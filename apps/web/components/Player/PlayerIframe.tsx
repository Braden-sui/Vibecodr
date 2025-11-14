"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Loader2 } from "lucide-react";
import { capsulesApi } from "@/lib/api";

export interface PlayerIframeProps {
  capsuleId: string;
  params?: Record<string, unknown>;
  onReady?: () => void;
  onLog?: (log: { level: string; message: string }) => void;
  onStats?: (stats: { fps: number; memory: number }) => void;
}

export function PlayerIframe({
  capsuleId,
  params = {},
  onReady,
  onLog,
  onStats,
}: PlayerIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const pauseStateRef = useRef<"paused" | "running">("running");

  useEffect(() => {
    if (!iframeRef.current) return;

    // Listen for messages from the iframe
    const handleMessage = (event: MessageEvent) => {
      // TODO: Verify origin matches our R2 domain
      // if (!event.origin.startsWith('https://capsules.vibecodr.space')) return;

      const { type, payload } = event.data;

      switch (type) {
        case "ready":
          setStatus("ready");
          onReady?.();
          break;

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
  }, [onReady, onLog, onStats]);

  // Send params to iframe when they change
  useEffect(() => {
    if (status === "ready" && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "setParams",
          payload: params,
        },
        "*" // TODO: Use specific origin
      );
    }
  }, [params, status]);

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
