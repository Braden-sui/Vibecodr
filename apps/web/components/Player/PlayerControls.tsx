"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ReportButton } from "@/components/ReportButton";
import {
  RotateCcw,
  StopCircle,
  Activity,
  Share2,
  Gauge,
} from "lucide-react";

export interface PlayerControlsProps {
  isRunning: boolean;
  stats?: {
    fps: number;
    memory: number;
    bootTime: number;
  };
  postId: string;
  onRestart: () => void;
  onKill: () => void;
  onShare: () => void;
}

export function PlayerControls({
  isRunning,
  stats,
  postId,
  onRestart,
  onKill,
  onShare,
}: PlayerControlsProps) {
  return (
    <div className="flex items-center justify-between border-t bg-card p-3">
      <div className="flex items-center gap-3">
        {/* Control Buttons */}
        <Button
          variant="outline"
          size="sm"
          onClick={onRestart}
          disabled={!isRunning}
          className="gap-1"
        >
          <RotateCcw className="h-4 w-4" />
          Restart
        </Button>

        <Button
          variant="destructive"
          size="sm"
          onClick={onKill}
          disabled={!isRunning}
          className="gap-1"
        >
          <StopCircle className="h-4 w-4" />
          Stop
        </Button>

        <Separator orientation="vertical" className="h-6" />

        {/* Performance Meter */}
        <div className="flex items-center gap-2 text-sm">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          {stats ? (
            <div className="flex items-center gap-3 text-muted-foreground">
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                {stats.fps} FPS
              </span>
              <span>
                {stats.memory > 0
                  ? `${(stats.memory / 1024 / 1024).toFixed(1)} MB`
                  : "—"}
              </span>
              <span>Boot: {stats.bootTime}ms</span>
            </div>
          ) : (
            <span className="text-muted-foreground">No stats</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Capability Badges */}
        <Badge variant="secondary" className="gap-1">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          Running
        </Badge>

        <Separator orientation="vertical" className="h-6" />

        {/* Action Buttons */}
        <Button variant="ghost" size="sm" onClick={onShare} className="gap-1">
          <Share2 className="h-4 w-4" />
          Share
        </Button>

        <ReportButton
          targetType="post"
          targetId={postId}
          variant="text"
          className="gap-1"
        />
      </div>
    </div>
  );
}
