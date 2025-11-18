"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  PlayerIframe,
  type PlayerIframeHandle,
} from "@/components/Player/PlayerIframe";
import { PlayerControls } from "@/components/Player/PlayerControls";
import { PlayerDrawer } from "@/components/Player/PlayerDrawer";
import { ParamControls } from "@/components/Player/ParamControls";
import { PlayerConsole, type PlayerConsoleEntry } from "@/components/Player/PlayerConsole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Sliders } from "lucide-react";
import { postsApi, runsApi, moderationApi, type FeedPost, mapApiFeedPostToFeedPost } from "@/lib/api";
import { trackClientError, trackEvent } from "@/lib/analytics";
import type { ManifestParam } from "@vibecodr/shared/manifest";
import { readPreviewHandoff, type PreviewLogEntry } from "@/lib/handoff";
import { budgeted } from "@/lib/perf";
import { ApiPostResponseSchema } from "@vibecodr/shared";

type PlayerPageClientProps = {
  postId: string;
};

const MAX_CONSOLE_LOGS = 120;
const LOG_SAMPLE_RATE = 0.2;
const LOG_BATCH_TARGET = 10;

type RunSession = {
  id: string;
  startedAt: number;
};

type PendingAnalyticsLog = {
  level: PlayerConsoleEntry["level"];
  message: string;
  timestamp: number;
  source: PlayerConsoleEntry["source"];
  sampleRate: number;
};

type PublicMetadata = {
  role?: string;
  isModerator?: boolean;
} | null;

export default function PlayerPageClient({ postId }: PlayerPageClientProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ fps: 0, memory: 0, bootTime: 0 });
  const [capsuleParams, setCapsuleParams] = useState<Record<string, unknown>>({});
  const [areParamsOpen, setAreParamsOpen] = useState(false);
  const [post, setPost] = useState<FeedPost | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<PlayerConsoleEntry[]>([]);
  const [isConsoleCollapsed, setIsConsoleCollapsed] = useState(true);
  const [moderationStatus, setModerationStatus] = useState<{ quarantined: boolean; pendingFlags: number } | null>(null);
  const [isUnquarantining, setIsUnquarantining] = useState(false);
  const iframeHandleRef = useRef<PlayerIframeHandle | null>(null);
  const currentRunRef = useRef<RunSession | null>(null);
  const pendingLogBatchRef = useRef<PendingAnalyticsLog[]>([]);
  const flushLogsTimeoutRef = useRef<number | null>(null);
  const handoffPrefillAppliedRef = useRef(false);
  const { user, isSignedIn } = useUser();
  const searchParams = useSearchParams();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isModeratorFlag = metadata?.isModerator === true;
  const isModeratorOrAdmin =
    !!user && isSignedIn && (role === "admin" || role === "moderator" || isModeratorFlag);
  const tabParam = searchParams.get("tab");
  const initialTab: "notes" | "remix" | "chat" =
    tabParam === "chat" || tabParam === "comments"
      ? "chat"
      : tabParam === "remix"
      ? "remix"
      : "notes";
  const capsuleParamDefs = post?.capsule?.params;
  const manifestParams = useMemo<ManifestParam[]>(() => {
    if (!capsuleParamDefs || !Array.isArray(capsuleParamDefs)) {
      return [];
    }
    return capsuleParamDefs.filter(isManifestParam);
  }, [capsuleParamDefs]);
  const statFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 1,
      }),
    []
  );

  useEffect(() => {
    handoffPrefillAppliedRef.current = false;
  }, [postId]);

  useEffect(() => {
    setConsoleEntries([]);
    setIsConsoleCollapsed(true);
  }, [postId]);

  const appendConsoleEntry = useCallback((entry: PlayerConsoleEntry) => {
    setConsoleEntries((prev) => [...prev, entry].slice(-MAX_CONSOLE_LOGS));
  }, []);

  const handleUnquarantine = useCallback(async () => {
    if (!post || !isModeratorOrAdmin || isUnquarantining) return;

    setIsUnquarantining(true);
    try {
      const response = await moderationApi.moderatePost(post.id, "unquarantine");
      if (!response.ok) {
        // Soft-fail: leave current banner; moderators can retry or use other tools.
        return;
      }
      setModerationStatus((prev) => (prev ? { ...prev, quarantined: false } : prev));
    } finally {
      setIsUnquarantining(false);
    }
  }, [isModeratorOrAdmin, isUnquarantining, post]);

  const flushLogBatch = useCallback(
    (explicitRunId?: string) => {
      if (pendingLogBatchRef.current.length === 0) {
        return;
      }
      const capsuleId = post?.capsule?.id;
      if (!capsuleId || !post?.id) {
        pendingLogBatchRef.current = [];
        return;
      }
      const runId = explicitRunId ?? currentRunRef.current?.id;
      if (!runId) {
        return;
      }

      const payload = pendingLogBatchRef.current.splice(0, pendingLogBatchRef.current.length);
      if (flushLogsTimeoutRef.current) {
        clearTimeout(flushLogsTimeoutRef.current);
        flushLogsTimeoutRef.current = null;
      }

      runsApi
        .appendLogs(runId, {
          capsuleId,
          postId: post.id,
          logs: payload.map((item) => ({
            level: item.level,
            message: item.message,
            timestamp: item.timestamp,
            source: item.source,
            sampleRate: item.sampleRate,
          })),
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("E-VIBECODR-0515 player appendLogs failed", {
              runId,
              capsuleId,
              postId: post?.id,
              error: message,
            });
          }
          trackClientError("E-VIBECODR-0515", {
            area: "player.appendLogs",
            runId,
            capsuleId,
            postId: post?.id,
            message,
          });
        });
    },
    [post?.capsule?.id, post?.id]
  );

  const enqueueAnalyticsLog = useCallback(
    (entry: PlayerConsoleEntry, sampleRate: number) => {
      pendingLogBatchRef.current.push({
        level: entry.level,
        message: entry.message,
        timestamp: entry.timestamp,
        source: entry.source,
        sampleRate,
      });

      if (pendingLogBatchRef.current.length >= LOG_BATCH_TARGET) {
        flushLogBatch();
      } else if (!flushLogsTimeoutRef.current) {
        flushLogsTimeoutRef.current = window.setTimeout(() => {
          flushLogBatch();
        }, 1500);
      }
    },
    [flushLogBatch]
  );

  const maybeSendLogAnalytics = useCallback(
    (entry: PlayerConsoleEntry) => {
      if (!post?.capsule?.id || !post?.id) {
        return;
      }
      if (!currentRunRef.current) {
        return;
      }
      const forced = entry.level === "error";
      const shouldSample = forced || Math.random() < LOG_SAMPLE_RATE;
      if (!shouldSample) {
        return;
      }
      const sampleRate = forced ? 1 : LOG_SAMPLE_RATE;
      trackEvent("player_console_log", {
        postId: post.id,
        capsuleId: post.capsule.id,
        runId: currentRunRef.current.id,
        level: entry.level,
        source: entry.source,
        sampleRate,
      });
      enqueueAnalyticsLog(entry, sampleRate);
    },
    [enqueueAnalyticsLog, post?.capsule?.id, post?.id]
  );

  const handleConsoleLog = useCallback(
    (log: { level?: string; message?: string; timestamp?: number }) => {
      if (!post) {
        return;
      }
      const level = log.level;
      const normalizedLevel: PlayerConsoleEntry["level"] =
        level === "warn" || level === "error" || level === "info" ? level : "log";
      const message =
        typeof log.message === "string"
          ? log.message
          : log.message != null
          ? JSON.stringify(log.message)
          : "Console event";
      const entry: PlayerConsoleEntry = {
        id: createStableId("log"),
        level: normalizedLevel,
        message: message.slice(0, 500),
        timestamp: typeof log.timestamp === "number" ? log.timestamp : Date.now(),
        source: "player",
      };
      appendConsoleEntry(entry);
      maybeSendLogAnalytics(entry);
    },
    [appendConsoleEntry, maybeSendLogAnalytics, post]
  );

  const handleClearConsole = useCallback(() => {
    setConsoleEntries([]);
  }, []);

  const startRunSession = useCallback(() => {
    currentRunRef.current = {
      id: createStableId("run"),
      startedAt: Date.now(),
    };
  }, []);

  const finalizeRunSession = useCallback(
    (status: "completed" | "failed", errorMessage?: string) => {
      const session = currentRunRef.current;
      if (!session || !post?.capsule) {
        return;
      }
      flushLogBatch(session.id);
      currentRunRef.current = null;
      runsApi
        .complete({
          runId: session.id,
          capsuleId: post.capsule.id,
          postId: post.id,
          durationMs: Math.max(0, Date.now() - session.startedAt),
          status,
          errorMessage,
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("E-VIBECODR-0516 player complete run failed", {
              runId: session.id,
              capsuleId: post?.capsule?.id,
              postId: post?.id,
              status,
              error: message,
            });
          }
          trackClientError("E-VIBECODR-0516", {
            area: "player.completeRun",
            runId: session.id,
            capsuleId: post?.capsule?.id,
            postId: post?.id,
            status,
            message,
          });
        });
    },
    [flushLogBatch, post?.capsule, post?.id]
  );

  useEffect(() => {
    return () => {
      flushLogBatch();
      finalizeRunSession("completed");
    };
  }, [finalizeRunSession, flushLogBatch]);

  const handleRunnerReady = useCallback(() => {
    startRunSession();
    setIsRunning(true);
    if (post?.capsule) {
      trackEvent("player_run_started", {
        postId: post.id,
        capsuleId: post.capsule.id,
        runner: post.capsule.runner,
      });
    }
  }, [post, startRunSession]);

  const handleBootMetrics = useCallback(
    (metrics: { bootTimeMs: number }) => {
      setStats((prev) => ({ ...prev, bootTime: metrics.bootTimeMs }));
      if (post?.capsule) {
        trackEvent("player_boot_time", {
          postId: post.id,
          capsuleId: post.capsule.id,
          runner: post.capsule.runner,
          bootTimeMs: metrics.bootTimeMs,
        });
      }
    },
    [post]
  );

  const handleRuntimeError = useCallback(
    (message?: string) => {
      finalizeRunSession("failed", message);
      setIsRunning(false);
      setStats({ fps: 0, memory: 0, bootTime: 0 });
    },
    [finalizeRunSession]
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await postsApi.get(postId);
        if (!response.ok) {
          if (response.status === 404) {
            setError("not_found");
          } else {
            setError("failed");
          }
          return;
        }

        const data = ApiPostResponseSchema.parse(await response.json());
        const mapped = mapApiFeedPostToFeedPost(data.post);
        if (!cancelled) {
          setPost(mapped);
          trackEvent("player_loaded", {
            postId: mapped.id,
            type: mapped.type,
            hasCapsule: !!mapped.capsule,
          });
        }
      } catch (e) {
        console.error("Failed to load post for player:", e);
        if (!cancelled) {
          setError("failed");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [postId]);

  useEffect(() => {
    if (!isModeratorOrAdmin) {
      setModerationStatus(null);
      return;
    }

    let cancelled = false;

    const loadStatus = async () => {
      try {
        const res = await fetch(`/api/moderation/posts/${postId}/status`);
        if (!res.ok) {
          return;
        }
        let data: { quarantined?: boolean; pendingFlags?: number } | null = null;
        try {
          data = (await res.json()) as { quarantined?: boolean; pendingFlags?: number } | null;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("E-VIBECODR-0509 player moderation status JSON parse failed", {
              postId,
              status: res.status,
              error: message,
            });
          }
          trackClientError("E-VIBECODR-0509", {
            area: "player.moderationStatus",
            stage: "json_parse",
            postId,
            status: res.status,
            message,
          });
        }
        if (!cancelled && data) {
          const quarantined = data.quarantined === true;
          const pendingFlagsRaw = data.pendingFlags;
          const pendingFlags =
            typeof pendingFlagsRaw === "number"
              ? pendingFlagsRaw
              : Number(pendingFlagsRaw ?? 0) || 0;
          setModerationStatus({ quarantined, pendingFlags });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("E-VIBECODR-0510 player moderation status fetch failed", {
              postId,
              error: message,
            });
          }
          trackClientError("E-VIBECODR-0510", {
            area: "player.moderationStatus",
            stage: "fetch",
            postId,
            message,
          });
          setModerationStatus((prev) => prev);
        }
      }
    };

    loadStatus();

    return () => {
      cancelled = true;
    };
  }, [isModeratorOrAdmin, postId]);

  useEffect(() => {
    if (manifestParams.length === 0) {
      setCapsuleParams({});
      setAreParamsOpen(false);
      return;
    }

    setCapsuleParams((prev) => {
      const next: Record<string, unknown> = {};
      for (const param of manifestParams) {
        if (Object.prototype.hasOwnProperty.call(prev, param.name)) {
          next[param.name] = prev[param.name];
        } else {
          next[param.name] = param.default;
        }
      }
      return next;
    });
  }, [manifestParams]);

  // Apply any preview→player handoff param state and prefill logs.
  useEffect(() => {
    budgeted(`[player] handoff_read:${postId}`, () => {
      if (handoffPrefillAppliedRef.current) {
        return;
      }
      const { state } = readPreviewHandoff(postId);
      if (!state) return;
      handoffPrefillAppliedRef.current = true;
      if (state.params && typeof state.params === "object") {
        setCapsuleParams((prev) => ({ ...prev, ...(state.params as Record<string, unknown>) }));
      }
      if (state.logs && state.logs.length > 0) {
        setConsoleEntries((prev) => {
          const mapped = mapPreviewLogs(state.logs!, postId);
          return [...mapped, ...prev].slice(-MAX_CONSOLE_LOGS);
        });
        setIsConsoleCollapsed(false);
      }
    });
  }, [postId, manifestParams.length]);

  const postMessageToCapsule = useCallback(
    (type: string, payload?: unknown) => {
      const bridge = iframeHandleRef.current;
      if (!bridge) {
        console.warn(`[player] Ignoring ${type}; bridge not ready`);
        return false;
      }
      return bridge.postMessage(type, payload);
    },
    []
  );

  useEffect(() => {
    if (!isRunning || !post?.capsule) {
      return;
    }
    postMessageToCapsule("setParams", capsuleParams);
  }, [capsuleParams, isRunning, post?.capsule, postMessageToCapsule]);

  const handleRestart = () => {
    finalizeRunSession("completed");
    const restarted =
      (typeof iframeHandleRef.current?.restart === "function" && iframeHandleRef.current.restart()) ||
      postMessageToCapsule("restart");
    if (!restarted) {
      return;
    }
    setIsRunning(false);
    setStats({ fps: 0, memory: 0, bootTime: 0 });
    if (post?.capsule) {
      trackEvent("player_restart_requested", {
        postId: post.id,
        capsuleId: post.capsule.id,
        runner: post.capsule.runner,
      });
    }
  };

  const handleKill = () => {
    const sent =
      (typeof iframeHandleRef.current?.kill === "function" && iframeHandleRef.current?.kill()) ||
      postMessageToCapsule("kill");
    finalizeRunSession("failed", "killed_by_user");
    if (!sent) {
      return;
    }
    setIsRunning(false);
    setStats({ fps: 0, memory: 0, bootTime: 0 });
    if (post?.capsule) {
      trackEvent("player_kill_requested", {
        postId: post.id,
        capsuleId: post.capsule.id,
        runner: post.capsule.runner,
      });
    }
  };

  const handleShare = () => {
    const url = `${window.location.origin}/player/${postId}`;
    if (navigator.share) {
      navigator
        .share({
          title: post?.title ?? "Vibecodr vibe",
          text: post?.description,
          url,
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (typeof console !== "undefined" && typeof console.debug === "function") {
            console.debug("E-VIBECODR-0511 player share failed or was cancelled", {
              postId,
              error: message,
            });
          }
          trackClientError("E-VIBECODR-0511", {
            area: "player.share",
            postId,
            message,
          });
        });
    } else {
      navigator.clipboard.writeText(url).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("E-VIBECODR-0512 player clipboard write failed", {
            postId,
            error: message,
          });
        }
        trackClientError("E-VIBECODR-0512", {
          area: "player.shareClipboard",
          postId,
          message,
        });
      });
    }
  };

  const handleParamChange = (name: string, value: unknown) => {
    setCapsuleParams((prev) => {
      if (Object.is(prev[name], value)) {
        return prev;
      }
      return {
        ...prev,
        [name]: value,
      };
    });
  };

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Header */}
      <div className="border-b bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">{post?.title}</h1>
              <Link
                href={post ? `/u/${post.author.handle}` : "#"}
                className="text-sm text-muted-foreground hover:underline"
              >
                {post ? `by @${post.author.handle}` : ""}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {post && (
              <Badge variant="secondary">
                {post.type === "app" ? post.capsule?.runner || "client-static" : "report"}
              </Badge>
            )}
          </div>
        </div>
        {isModeratorOrAdmin && moderationStatus?.quarantined && (
          <div className="mt-2 flex flex-col gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-800">
            <div>
              <p className="font-medium">This post is quarantined.</p>
              <p className="mt-1">
                It is hidden from feeds and profile lists for all users. Use the tools below if this status was applied
                in error.
              </p>
            </div>
            <div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs border-orange-300 text-orange-800 hover:bg-orange-100"
                disabled={isUnquarantining}
                onClick={handleUnquarantine}
              >
                {isUnquarantining ? "Working…" : "Unquarantine post"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Main Player Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Player */}
        <div className="flex flex-1 flex-col">
          <div className="flex-1 p-4">
            {post?.capsule ? (
              <PlayerIframe
                ref={iframeHandleRef}
                capsuleId={post.capsule.id}
                artifactId={post.capsule.artifactId ?? undefined}
                params={capsuleParams}
                onReady={handleRunnerReady}
                onError={handleRuntimeError}
                onLog={handleConsoleLog}
                onStats={(s) => setStats((prev) => ({ ...prev, ...s }))}
                onBoot={handleBootMetrics}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed">
                <p className="text-sm text-muted-foreground">
                  {isLoading
                    ? "Loading vibe..."
                    : error === "not_found"
                    ? "Vibe not found."
                    : "This vibe does not have a runnable capsule attached yet."}
                </p>
              </div>
            )}
          </div>

          {/* Controls */}
          <PlayerControls
            isRunning={isRunning}
            stats={stats}
            postId={postId}
            onRestart={handleRestart}
            onKill={handleKill}
            onShare={handleShare}
          />
          <PlayerConsole
            entries={consoleEntries}
            collapsed={isConsoleCollapsed}
            onToggle={() => setIsConsoleCollapsed((prev) => !prev)}
            onClear={handleClearConsole}
          />
        </div>

        {/* Right: Drawer */}
        <div className="w-80">
          <PlayerDrawer
            postId={postId}
            notes={post?.description}
            remixInfo={{ changes: 0 }}
            initialTab={initialTab}
          />
        </div>
      </div>

      {manifestParams.length > 0 && (
        <div className="border-t bg-card/80">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold">Params</p>
                <p className="text-xs text-muted-foreground">
                  {manifestParams.length} control{manifestParams.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAreParamsOpen((prev) => !prev)}
              aria-expanded={areParamsOpen}
              className="gap-2"
            >
              {areParamsOpen ? "Hide Params" : "Params"}
            </Button>
          </div>
          {areParamsOpen && (
            <div className="max-h-80 overflow-y-auto px-4 pb-4">
              <ParamControls
                params={manifestParams}
                values={capsuleParams}
                onChange={handleParamChange}
                disabled={!post?.capsule}
              />
            </div>
          )}
        </div>
      )}
      {post && (
        <div className="border-t bg-card/70">
          <dl className="grid grid-cols-2 gap-3 px-4 py-3 md:grid-cols-4">
            {PLAYER_STATS_FIELDS.map(({ key, label, helper }) => (
              <div key={key} className="rounded-md border bg-background/80 p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-1 text-lg font-semibold">
                  {statFormatter.format(post.stats[key])}
                </dd>
                {helper && (
                  <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
                )}
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

const PLAYER_STATS_FIELDS: Array<{
  key: keyof FeedPost["stats"];
  label: string;
  helper?: string;
}> = [
  { key: "runs", label: "Runs", helper: "Unique executions" },
  { key: "likes", label: "Likes", helper: "Feed reactions" },
  { key: "comments", label: "Comments", helper: "Thread count" },
  { key: "remixes", label: "Remixes", helper: "Published forks" },
];

const PARAM_TYPES: ManifestParam["type"][] = ["slider", "toggle", "select", "text", "color", "number"];

function isManifestParam(param: unknown): param is ManifestParam {
  if (!param || typeof param !== "object") {
    return false;
  }

  const candidate = param as Partial<ManifestParam>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.type === "string" &&
    PARAM_TYPES.includes(candidate.type as ManifestParam["type"]) &&
    Object.prototype.hasOwnProperty.call(candidate, "default")
  );
}

function mapPreviewLogs(logs: PreviewLogEntry[], postId: string): PlayerConsoleEntry[] {
  return logs.map((log, idx) => ({
    id: `preview-${postId}-${idx}-${log.timestamp}`,
    level: log.level,
    message: log.message.slice(0, 500),
    timestamp: log.timestamp,
    source: "preview",
  }));
}

function createStableId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
