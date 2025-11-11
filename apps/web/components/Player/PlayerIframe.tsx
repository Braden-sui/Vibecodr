"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Loader2 } from "lucide-react";

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

  useEffect(() => {
    if (!iframeRef.current) return;

    // Listen for messages from the iframe
    const handleMessage = (event: MessageEvent) => {
      // TODO: Verify origin matches our R2 domain
      // if (!event.origin.startsWith('https://capsules.vibecodr.com')) return;

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

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border bg-background">
      {/* Loading State */}
      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Loading capsule...</p>
        </div>
      )}

      {/* Error State */}
      {status === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 p-8 backdrop-blur-sm">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h3 className="mt-4 text-lg font-semibold">Failed to load capsule</h3>
          <p className="mt-2 text-center text-sm text-muted-foreground">{errorMessage}</p>
          <Badge variant="destructive" className="mt-4">
            Error
          </Badge>
        </div>
      )}

      {/* Sandboxed Iframe */}
      <iframe
        ref={iframeRef}
        src={`/api/capsules/${capsuleId}/run`} // TODO: Update with actual R2 URL
        className="h-full w-full"
        sandbox="allow-scripts allow-same-origin"
        allow=""
        title="Capsule Runner"
        style={{
          border: "none",
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
}
