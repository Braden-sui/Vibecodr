"use client";

import { forwardRef } from "react";
import { Badge } from "@/components/ui/badge";
import { PlayerConsole, type PlayerConsoleEntry } from "@/components/Player/PlayerConsole";
import { PlayerControlsProps, PlayerControls } from "@/components/Player/PlayerControls";
import {
  PlayerIframe,
  type PlayerIframeHandle,
  type PlayerIframeProps,
} from "@/components/Player/PlayerIframe";
import type { RunnerType } from "@vibecodr/shared/manifest";

export interface PlayerShellProps {
  capsuleId?: string;
  artifactId?: string;
  runnerType?: RunnerType;
  params?: Record<string, unknown>;
  postId: string;
  isRunning: boolean;
  stats: PlayerControlsProps["stats"];
  consoleEntries: PlayerConsoleEntry[];
  consoleCollapsed: boolean;
  onConsoleToggle: () => void;
  onClearConsole: () => void;
  onRestart: () => void;
  onKill: () => void;
  onShare: () => void;
  onCopyEmbed?: () => void;
  isLoading: boolean;
  loadError: string | null;
  onReady?: PlayerIframeProps["onReady"];
  onLog?: PlayerIframeProps["onLog"];
  onStats?: PlayerIframeProps["onStats"];
  onBoot?: PlayerIframeProps["onBoot"];
  onError?: PlayerIframeProps["onError"];
  onLoading?: PlayerIframeProps["onLoading"];
  /** Called when runtimeSession boot timeout fires. */
  onBootTimeout?: PlayerIframeProps["onBootTimeout"];
  /** Called when runtimeSession run timeout fires. */
  onRunTimeout?: PlayerIframeProps["onRunTimeout"];
}

function computePlaceholder(loadError: string | null, isLoading: boolean) {
  if (isLoading) return "Loading vibe...";
  if (loadError === "not_found") return "Vibe not found.";
  return "This vibe does not have a playable app attached yet.";
}

export const PlayerShell = forwardRef<PlayerIframeHandle, PlayerShellProps>(function PlayerShell(
  {
    capsuleId,
    artifactId,
    runnerType,
    params,
    postId,
    isRunning,
    stats,
    consoleEntries,
    consoleCollapsed,
    onConsoleToggle,
    onClearConsole,
    onRestart,
    onKill,
    onShare,
    onCopyEmbed,
    isLoading,
    loadError,
    onReady,
    onLog,
    onStats,
    onBoot,
    onError,
    onLoading,
    onBootTimeout,
    onRunTimeout,
  },
  ref
) {
  const placeholderText = computePlaceholder(loadError, isLoading);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 p-4">
        {capsuleId ? (
          <PlayerIframe
            ref={ref}
            capsuleId={capsuleId}
            artifactId={artifactId}
            runnerType={runnerType}
            params={params}
            onReady={onReady}
            onLog={onLog}
            onStats={onStats}
            onBoot={onBoot}
            onError={onError}
            onLoading={onLoading}
            onBootTimeout={onBootTimeout}
            onRunTimeout={onRunTimeout}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed bg-background/80">
            <div className="text-center text-sm text-muted-foreground">
              <Badge variant="outline" className="mb-2 text-xs">
                Waiting
              </Badge>
              <p>{placeholderText}</p>
            </div>
          </div>
        )}
      </div>

      <PlayerControls
        isRunning={isRunning}
        stats={stats}
        postId={postId}
        onRestart={onRestart}
        onKill={onKill}
        onShare={onShare}
        onCopyEmbed={onCopyEmbed}
      />

      <PlayerConsole
        entries={consoleEntries}
        collapsed={consoleCollapsed}
        onToggle={onConsoleToggle}
        onClear={onClearConsole}
      />
    </div>
  );
});
