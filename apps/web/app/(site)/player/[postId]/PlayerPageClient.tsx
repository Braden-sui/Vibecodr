"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useUser, useAuth } from "@clerk/clerk-react";
import { type PlayerIframeHandle } from "@/components/Player/PlayerIframe";
import { PlayerDrawer } from "@/components/Player/PlayerDrawer";
import { ParamControls } from "@/components/Player/ParamControls";
import { PlayerConsoleEntry } from "@/components/Player/PlayerConsole";
import { PlayerShell } from "@/components/PlayerShell";
import {
  confirmRuntimeSlot,
  getRuntimeBudgets,
  releaseRuntimeSlot,
  reserveRuntimeSlot,
} from "@/components/Player/runtimeBudgets";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Sliders } from "lucide-react";
import { postsApi, runsApi, moderationApi, type FeedPost, mapApiFeedPostToFeedPost } from "@/lib/api";
import { trackClientError, trackEvent, trackRuntimeEvent } from "@/lib/analytics";
import { toast } from "@/lib/toast";
import type { ManifestParam } from "@vibecodr/shared/manifest";
import { readPreviewHandoff, type PreviewLogEntry } from "@/lib/handoff";
import { budgeted } from "@/lib/perf";
import { ApiPostResponseSchema } from "@vibecodr/shared";
import { usePageMeta } from "@/lib/seo";

type PlayerPageClientProps = {
  postId: string;
};

const MAX_CONSOLE_LOGS = 120;
const LOG_SAMPLE_RATE = 0.2;
const LOG_BATCH_TARGET = 10;
const PERF_SAMPLE_RATE = 0.25;
const PERF_EVENT_MIN_INTERVAL_MS = 2000;
const RUNTIME_BUDGETS = getRuntimeBudgets();
const CLIENT_STATIC_BOOT_BUDGET_MS = RUNTIME_BUDGETS.clientStaticBootMs;
const RUN_SESSION_BUDGET_MS = RUNTIME_BUDGETS.runSessionMs;
const MAX_CONCURRENT_RUNNERS = RUNTIME_BUDGETS.maxConcurrentRunners;

type RunSession = {
  id: string;
  startedAt: number;
};

type RuntimeBudgetReason = "boot_timeout" | "run_timeout" | "concurrency_limit";

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

function isClientStaticRunnerType(runner?: string | null): boolean {
  if (!runner) return true;
  const normalized = runner.toLowerCase();
  return normalized === "client-static" || normalized === "html";
}
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
  const lastRunRef = useRef<RunSession | null>(null);
  const finishedRunRef = useRef<{ runId: string; status: "completed" | "failed" } | null>(null);
  const runStartInFlightRef = useRef(false);
  const pendingRunStartRef = useRef<Promise<RunSession | null> | null>(null);
  const runtimeSlotRef = useRef<symbol | string | null>(null);
  const bootTimerRef = useRef<number | null>(null);
  const runTimerRef = useRef<number | null>(null);
  const budgetStateRef = useRef<{ bootStartedAt: number | null; runStartedAt: number | null; budgetViolated: boolean }>({
    bootStartedAt: null,
    runStartedAt: null,
    budgetViolated: false,
  });
  const pendingLogBatchRef = useRef<PendingAnalyticsLog[]>([]);
  const flushLogsTimeoutRef = useRef<number | null>(null);
  const lastPerfEventRef = useRef<number>(0);
  const handoffPrefillAppliedRef = useRef(false);
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isModeratorFlag = metadata?.isModerator === true;
  const isModeratorOrAdmin =
    !!user && isSignedIn && (role === "admin" || role === "moderator" || isModeratorFlag);
  const actorId = user?.id ?? null;
  const [authzState, setAuthzState] = useState<"unknown" | "unauthenticated" | "forbidden" | "authorized">("unknown");
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
  const origin =
    typeof window !== "undefined" && window.location && typeof window.location.origin === "string"
      ? window.location.origin
      : "";
  const canonicalUrl = origin ? `${origin}/player/${postId}` : undefined;
  const ogImageUrl = canonicalUrl ? `${origin}/api/og-image/${postId}` : undefined;
  const oEmbedUrl = canonicalUrl
    ? `${origin}/api/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`
    : undefined;

  usePageMeta({
    title: post ? `${post.title} | Vibecodr Player` : "Vibecodr Player",
    description: post?.description ?? undefined,
    url: canonicalUrl,
    image: ogImageUrl,
    type: post?.capsule ? "video.other" : "article",
    oEmbedUrl,
    canonicalUrl,
  });

  const buildAuthInit = async (): Promise<RequestInit | undefined> => {
    if (typeof getToken !== "function") return undefined;
    const token = await getToken({ template: "workers" });
    if (!token) return undefined;
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  };

  const handleDrawerTabChange = useCallback(
    (next: "notes" | "remix" | "chat") => {
      const current = searchParams.get("tab") ?? "notes";
      const canonical = next === "chat" ? "chat" : next === "remix" ? "remix" : "notes";
      if (current === canonical) {
        return;
      }

      const nextParams = new URLSearchParams(searchParams);
      if (canonical === "notes") {
        nextParams.delete("tab");
      } else {
        nextParams.set("tab", canonical);
      }
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams],
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
    if (!post || isUnquarantining) return;
    if (authzState !== "authorized") {
      toast({
        title: "Not authorized",
        description: "Moderator or admin access is required to unquarantine posts.",
        variant: "error",
      });
      return;
    }

    setIsUnquarantining(true);
    try {
      const init = await buildAuthInit();
      if (!init) {
        setAuthzState("unauthenticated");
        throw new Error("Authentication is required to perform moderation actions.");
      }
      const notes = `source=player_page | action=unquarantine | target=post:${post.id}${actorId ? ` | actor=${actorId}` : ""}`;
      const response = await moderationApi.moderatePost(post.id, "unquarantine", init, notes);
      if (!response.ok) {
        // Soft-fail: leave current banner; moderators can retry or use other tools.
        return;
      }
      setModerationStatus((prev) => (prev ? { ...prev, quarantined: false } : prev));
    } finally {
      setIsUnquarantining(false);
    }
  }, [actorId, authzState, isUnquarantining, post]);

  const clearBootTimer = useCallback(() => {
    if (bootTimerRef.current) {
      clearTimeout(bootTimerRef.current);
      bootTimerRef.current = null;
    }
  }, []);

  const clearRunTimer = useCallback(() => {
    if (runTimerRef.current) {
      clearTimeout(runTimerRef.current);
      runTimerRef.current = null;
    }
  }, []);

  const clearBudgetTimers = useCallback(() => {
    clearBootTimer();
    clearRunTimer();
  }, [clearBootTimer, clearRunTimer]);

  const releaseRuntimeSlotGuard = useCallback(() => {
    if (runtimeSlotRef.current) {
      releaseRuntimeSlot(runtimeSlotRef.current);
      runtimeSlotRef.current = null;
    }
  }, []);

  const resetBudgetState = useCallback(() => {
    budgetStateRef.current = {
      bootStartedAt: null,
      runStartedAt: null,
      budgetViolated: false,
    };
  }, []);

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

      buildAuthInit()
        .then((init) => {
          if (!init) {
            trackClientError("E-VIBECODR-0515", {
              area: "player.appendLogs",
              runId,
              capsuleId,
              postId: post?.id,
              message: "Missing auth token for run logging",
            });
            return;
          }
          return runsApi.appendLogs(
            runId,
            {
              capsuleId,
              postId: post.id,
              logs: payload.map((item) => ({
                level: item.level,
                message: item.message,
                timestamp: item.timestamp,
                source: item.source,
                sampleRate: item.sampleRate,
              })),
            },
            init
          );
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
      const runId = currentRunRef.current?.id;
      if (!post?.capsule?.id || !post?.id || !runId) {
        return;
      }
      const forced = entry.level === "error";
      const shouldSample = forced || Math.random() < LOG_SAMPLE_RATE;
      if (!shouldSample) {
        return;
      }
      const sampleRate = forced ? 1 : LOG_SAMPLE_RATE;
      trackRuntimeEvent("player_console_log", {
        capsuleId: post.capsule.id,
        artifactId: post.capsule.artifactId ?? null,
        runtimeType: post.capsule.runner ?? null,
        message: entry.message,
        properties: {
          postId: post.id,
          runId,
          level: entry.level,
          source: entry.source,
          sampleRate,
        },
        timestamp: entry.timestamp,
      });
      enqueueAnalyticsLog(entry, sampleRate);
    },
    [enqueueAnalyticsLog, post?.capsule?.id, post?.id]
  );

  const maybeSendPerfAnalytics = useCallback(
    (stats: { fps: number; memory: number }) => {
      const runId = currentRunRef.current?.id;
      if (!post?.capsule?.id || !post?.id || !runId) {
        return;
      }
      const now = Date.now();
      if (now - lastPerfEventRef.current < PERF_EVENT_MIN_INTERVAL_MS) {
        return;
      }
      const shouldSample = Math.random() < PERF_SAMPLE_RATE;
      if (!shouldSample) {
        return;
      }
      lastPerfEventRef.current = now;
      trackRuntimeEvent("player_perf_sample", {
        capsuleId: post.capsule.id,
        artifactId: post.capsule.artifactId ?? null,
        runtimeType: post.capsule.runner ?? null,
        properties: {
          postId: post.id,
          runId,
          fps: stats.fps,
          memory: stats.memory,
        },
        timestamp: now,
      });
    },
    [post?.capsule?.artifactId, post?.capsule?.id, post?.capsule?.runner, post?.id]
  );

  const handleStatsUpdate = useCallback(
    (s: { fps: number; memory: number }) => {
      setStats((prev) => ({ ...prev, ...s }));
      maybeSendPerfAnalytics(s);
    },
    [maybeSendPerfAnalytics]
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


  const finalizeRunSession = useCallback(
    (status: "completed" | "failed", errorMessage?: string) => {
      clearBudgetTimers();
      releaseRuntimeSlotGuard();
      resetBudgetState();
      const session = currentRunRef.current;
      const currentPost = post;
      const capsule = currentPost?.capsule;
      if (!session || !capsule) {
        return;
      }
      if (finishedRunRef.current?.runId === session.id) {
        const existingStatus = finishedRunRef.current.status;
        if (existingStatus === status) {
          return;
        }
        if (existingStatus === "failed" && status === "completed") {
          return;
        }
      }
      const durationMs = Math.max(0, Date.now() - session.startedAt);
      flushLogBatch(session.id);
      currentRunRef.current = null;
      finishedRunRef.current = { runId: session.id, status };
      const completePayload = {
        runId: session.id,
        capsuleId: capsule.id,
        postId: currentPost.id,
        durationMs,
        status,
        errorMessage,
      };

      buildAuthInit()
        .then((init) => {
          if (!init) {
            trackClientError("E-VIBECODR-0516", {
              area: "player.completeRun",
              runId: session.id,
              capsuleId: capsule.id,
              postId: currentPost?.id,
              status,
              message: "Missing auth token for run completion",
            });
            return;
          }
          return runsApi.complete(completePayload, init);
        })
        .then(async (response) => {
          if (!response) return;
          if (!response.ok) {
            let code: string | undefined;
            try {
              const body = (await response.clone().json()) as { code?: string };
              if (typeof body?.code === "string") {
                code = body.code;
              }
              if (code === "E-VIBECODR-0609") {
                toast({
                  title: "Run stopped by budget",
                  description: `Runs stop after ${Math.round(RUN_SESSION_BUDGET_MS / 1000)}s to keep the player stable.`,
                  variant: "warning",
                });
              }
            } catch {
              // ignore body parsing failures
            }
            trackClientError("E-VIBECODR-0516", {
              area: "player.completeRun",
              runId: session.id,
              capsuleId: capsule.id,
              postId: currentPost?.id,
              status,
              message: `status=${response.status}`,
              code,
            });
            return;
          }
          trackRuntimeEvent("player_run_completed", {
            capsuleId: capsule.id,
            artifactId: capsule.artifactId ?? null,
            runtimeType: capsule.runner ?? null,
            properties: { postId: currentPost.id, runId: session.id, status },
            message: errorMessage ?? undefined,
            timestamp: Date.now(),
          });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("E-VIBECODR-0516 player complete run failed", {
              runId: session.id,
              capsuleId: capsule.id,
              postId: currentPost?.id,
              status,
              error: message,
            });
          }
          trackClientError("E-VIBECODR-0516", {
            area: "player.completeRun",
            runId: session.id,
            capsuleId: capsule.id,
            postId: currentPost?.id,
            status,
            message,
          });
        });
    },
    [buildAuthInit, clearBudgetTimers, flushLogBatch, post, releaseRuntimeSlotGuard, resetBudgetState]
  );

  const handleBudgetViolation = useCallback(
    (
      reason: RuntimeBudgetReason,
      context?: { limitMs?: number; observedMs?: number; activeCount?: number }
    ) => {
      if (budgetStateRef.current.budgetViolated) {
        return;
      }
      budgetStateRef.current.budgetViolated = true;
      clearBudgetTimers();
      const run = currentRunRef.current ?? lastRunRef.current;
      const capsule = post?.capsule;
      const baseProperties = {
        postId: post?.id,
        runId: run?.id ?? null,
        reason,
        limitMs: context?.limitMs ?? null,
        observedMs: context?.observedMs ?? null,
        activeRunners: context?.activeCount ?? null,
      };
      const message =
        reason === "concurrency_limit"
          ? "Runtime blocked: too many active runs"
          : reason === "boot_timeout"
          ? "Runtime blocked: boot timed out"
          : "Runtime blocked: session exceeded max duration";

      trackRuntimeEvent("runtime_budget_exceeded", {
        capsuleId: capsule?.id,
        artifactId: capsule?.artifactId ?? null,
        runtimeType: capsule?.runner ?? null,
        properties: baseProperties,
        message,
      });

      trackRuntimeEvent("runtime_killed", {
        capsuleId: capsule?.id,
        artifactId: capsule?.artifactId ?? null,
        runtimeType: capsule?.runner ?? null,
        properties: { ...baseProperties, killedBy: "budget" },
        message,
      });

      const toastDescription =
        reason === "concurrency_limit"
          ? `You can run up to ${MAX_CONCURRENT_RUNNERS} vibe${
              MAX_CONCURRENT_RUNNERS === 1 ? "" : "s"
            } at once. Stop one to start a new run.`
          : reason === "boot_timeout"
          ? "This vibe took too long to start, so we stopped it to keep the player responsive."
          : `We stop runs after ${Math.round(RUN_SESSION_BUDGET_MS / 1000)}s to keep things stable. Restart to try again.`;

      toast({
        title: "Run stopped",
        description: toastDescription,
        variant: "warning",
      });

      iframeHandleRef.current?.kill?.();
      finalizeRunSession("failed", reason);
      setIsRunning(false);
      setStats({ fps: 0, memory: 0, bootTime: 0 });
    },
    [clearBudgetTimers, finalizeRunSession, post]
  );

  const startRunSession = useCallback(async (): Promise<RunSession | null> => {
    if (!post?.capsule?.id || !post?.id) {
      return null;
    }
    if (currentRunRef.current) {
      return currentRunRef.current;
    }
    if (pendingRunStartRef.current) {
      return pendingRunStartRef.current;
    }
    const startPromise = (async () => {
      runStartInFlightRef.current = true;

      if (!runtimeSlotRef.current) {
        const reservation = reserveRuntimeSlot();
        if (!reservation.allowed) {
          runStartInFlightRef.current = false;
          handleBudgetViolation("concurrency_limit", {
            activeCount: reservation.activeCount,
          });
          return null;
        }
        runtimeSlotRef.current = reservation.token;
      }

      const provisionalRunId = createStableId("run");
      try {
        const init = await buildAuthInit();
        if (!init) {
          trackClientError("E-VIBECODR-0517", {
            area: "player.startRun",
            runId: provisionalRunId,
            capsuleId: post.capsule.id,
            postId: post.id,
            message: "Missing auth token for run start",
          });
          releaseRuntimeSlotGuard();
          return null;
        }

      const response = await runsApi.start(
        { runId: provisionalRunId, capsuleId: post.capsule.id, postId: post.id },
        init
      );

      if (!response.ok) {
        let reason = `status=${response.status}`;
        let errorCode: string | undefined;
        let limit: number | undefined;
        let plan: string | undefined;
        let runsUsed: number | null = null;
        let maxRuns: number | null = null;
        try {
          const body = (await response.json()) as {
            reason?: string;
            code?: string;
            limit?: number;
            plan?: string;
            limits?: { maxRuns?: number };
            runsThisMonth?: number;
          };
          if (typeof body?.reason === "string") {
            reason = body.reason;
          }
          if (typeof body?.code === "string") {
            errorCode = body.code;
          }
          if (typeof body?.limit === "number") {
            limit = body.limit;
          }
          if (typeof body?.plan === "string") {
            plan = body.plan;
          }
          if (typeof body?.runsThisMonth === "number") {
            runsUsed = body.runsThisMonth;
          }
          if (typeof body?.limits?.maxRuns === "number") {
            maxRuns = body.limits.maxRuns;
          }
          if (response.status === 429) {
            if (errorCode === "E-VIBECODR-0608") {
              toast({
                title: "Too many active runs",
                description: `You can run up to ${limit ?? MAX_CONCURRENT_RUNNERS} vibe${
                  (limit ?? MAX_CONCURRENT_RUNNERS) === 1 ? "" : "s"
                } at once. Stop one to start another.`,
                variant: "error",
              });
            } else {
              const planLabel = (() => {
                switch (plan) {
                  case "free":
                    return "Free";
                  case "creator":
                    return "Creator";
                  case "pro":
                    return "Pro";
                  case "team":
                    return "Team";
                  default:
                    return null;
                }
              })();
              const usageSummary =
                runsUsed != null && maxRuns != null
                  ? `${runsUsed}/${maxRuns} runs this month`
                  : null;
              const planAwareDescription = (() => {
                if (plan === "free") {
                  return [
                    "You are out of run time on the free plan.",
                    usageSummary ? `You have used ${usageSummary}.` : null,
                    "Upgrade to keep running vibes.",
                  ]
                    .filter(Boolean)
                    .join(" ");
                }
                if (planLabel) {
                  return [
                    `You have reached the ${planLabel} plan run quota.`,
                    usageSummary ? `You have used ${usageSummary}.` : null,
                    "Upgrade to unlock more runtime.",
                  ]
                    .filter(Boolean)
                    .join(" ");
                }
                return body?.reason ?? "Monthly run quota exceeded. Try again after upgrading your plan.";
              })();
              toast({
                title: planLabel ? `${planLabel} plan limit reached` : "Run limit reached",
                description: planAwareDescription,
                variant: "error",
              });
            }
          }
        } catch {
          // ignore parse failures
        }
        trackClientError("E-VIBECODR-0517", {
            area: "player.startRun",
            runId: provisionalRunId,
            capsuleId: post.capsule.id,
            postId: post.id,
            message: reason,
            status: response.status,
          });
          releaseRuntimeSlotGuard();
          return null;
        }

        let resolvedRunId = provisionalRunId;
        try {
          const payload = (await response.json()) as { runId?: string | null };
          if (payload?.runId && typeof payload.runId === "string") {
            resolvedRunId = payload.runId;
          }
        } catch {
          // keep provisional run id if parsing fails
        }

        const session: RunSession = {
          id: resolvedRunId,
          startedAt: Date.now(),
        };
        currentRunRef.current = session;
        lastRunRef.current = session;
        finishedRunRef.current = null;

        const confirmation = confirmRuntimeSlot(runtimeSlotRef.current ?? session.id, session.id);
        runtimeSlotRef.current = confirmation.allowed ? session.id : runtimeSlotRef.current;
        budgetStateRef.current.runStartedAt = session.startedAt;
        clearRunTimer();
        runTimerRef.current = window.setTimeout(() => {
          handleBudgetViolation("run_timeout", {
            limitMs: RUN_SESSION_BUDGET_MS,
            observedMs: RUN_SESSION_BUDGET_MS,
          });
        }, RUN_SESSION_BUDGET_MS);

        if (!confirmation.allowed) {
          handleBudgetViolation("concurrency_limit", {
            activeCount: confirmation.activeCount,
          });
          return null;
        }

        return session;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        trackClientError("E-VIBECODR-0517", {
          area: "player.startRun",
          runId: provisionalRunId,
          capsuleId: post?.capsule?.id,
          postId: post?.id,
          message,
        });
        releaseRuntimeSlotGuard();
        clearRunTimer();
        return null;
      } finally {
        runStartInFlightRef.current = false;
      }
    })();

    pendingRunStartRef.current = startPromise;
    const result = await startPromise;
    pendingRunStartRef.current = null;
    return result;
  }, [buildAuthInit, clearRunTimer, handleBudgetViolation, post, releaseRuntimeSlotGuard]);

  const handleRuntimeLoading = useCallback(() => {
    if (!runtimeSlotRef.current) {
      const reservation = reserveRuntimeSlot();
      runtimeSlotRef.current = reservation.allowed ? reservation.token : null;
      if (!reservation.allowed) {
        handleBudgetViolation("concurrency_limit", { activeCount: reservation.activeCount });
        return;
      }
    }
    budgetStateRef.current.budgetViolated = false;
    budgetStateRef.current.bootStartedAt = Date.now();
    budgetStateRef.current.runStartedAt = null;
    clearBudgetTimers();
    if (isClientStaticRunnerType(post?.capsule?.runner ?? null)) {
      bootTimerRef.current = window.setTimeout(() => {
        handleBudgetViolation("boot_timeout", {
          limitMs: CLIENT_STATIC_BOOT_BUDGET_MS,
          observedMs: CLIENT_STATIC_BOOT_BUDGET_MS,
        });
      }, CLIENT_STATIC_BOOT_BUDGET_MS);
    }
    setIsRunning(true);
    void (async () => {
      const session = await startRunSession();
      if (!session) {
        clearBudgetTimers();
        releaseRuntimeSlotGuard();
        setIsRunning(false);
        resetBudgetState();
      }
    })();
  }, [clearBudgetTimers, handleBudgetViolation, post?.capsule?.runner, releaseRuntimeSlotGuard, resetBudgetState, startRunSession]);

  useEffect(() => {
    return () => {
      flushLogBatch();
      finalizeRunSession("completed");
    };
  }, [finalizeRunSession, flushLogBatch]);

  const handleRunnerReady = useCallback(() => {
    clearBootTimer();
    void (async () => {
      const session = await startRunSession();
      if (!session) {
        setIsRunning(false);
        setStats({ fps: 0, memory: 0, bootTime: 0 });
        iframeHandleRef.current?.kill();
        return;
      }
      if (isClientStaticRunnerType(post?.capsule?.runner ?? null) && budgetStateRef.current.bootStartedAt) {
        const bootElapsed = Math.max(0, Date.now() - budgetStateRef.current.bootStartedAt);
        if (bootElapsed > CLIENT_STATIC_BOOT_BUDGET_MS) {
          handleBudgetViolation("boot_timeout", {
            limitMs: CLIENT_STATIC_BOOT_BUDGET_MS,
            observedMs: bootElapsed,
          });
          return;
        }
      }
      setIsRunning(true);
      lastPerfEventRef.current = 0;
      if (post?.capsule) {
        trackEvent("player_run_started", {
          postId: post.id,
          capsuleId: post.capsule.id,
          runner: post.capsule.runner,
          });
          trackRuntimeEvent("player_run_started", {
            capsuleId: post.capsule.id,
            artifactId: post.capsule.artifactId ?? null,
            runtimeType: post.capsule.runner ?? null,
            properties: { postId: post.id, runId: session.id },
          });
      }
    })();
  }, [clearBootTimer, handleBudgetViolation, post, startRunSession]);

  const handleBootMetrics = useCallback(
    (metrics: { bootTimeMs: number }) => {
      setStats((prev) => ({ ...prev, bootTime: metrics.bootTimeMs }));
      if (isClientStaticRunnerType(post?.capsule?.runner ?? null) && metrics.bootTimeMs > CLIENT_STATIC_BOOT_BUDGET_MS) {
        handleBudgetViolation("boot_timeout", {
          limitMs: CLIENT_STATIC_BOOT_BUDGET_MS,
          observedMs: metrics.bootTimeMs,
        });
      }
      if (post?.capsule) {
        const runId = currentRunRef.current?.id;
        trackEvent("player_boot_time", {
          postId: post.id,
          capsuleId: post.capsule.id,
          runner: post.capsule.runner,
          bootTimeMs: metrics.bootTimeMs,
        });
        trackRuntimeEvent("player_boot_time", {
          capsuleId: post.capsule.id,
          artifactId: post.capsule.artifactId ?? null,
          runtimeType: post.capsule.runner ?? null,
          properties: { postId: post.id, runId },
          timestamp: Date.now(),
          message: `boot_time_ms=${metrics.bootTimeMs}`,
        });
      }
    },
    [handleBudgetViolation, post]
  );

  const handleRuntimeError = useCallback(
    (message?: string) => {
      if (!currentRunRef.current && lastRunRef.current) {
        currentRunRef.current = lastRunRef.current;
      }
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
        const init = await buildAuthInit();
        const response = await postsApi.get(postId, init);
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
    if (!isSignedIn) {
      setAuthzState("unauthenticated");
    } else if (!isModeratorOrAdmin) {
      setAuthzState("forbidden");
    } else {
      setAuthzState("authorized");
    }
  }, [isModeratorOrAdmin, isSignedIn]);

  useEffect(() => {
    if (!isModeratorOrAdmin) {
      setModerationStatus(null);
      return;
    }

    let cancelled = false;

    const loadStatus = async () => {
      try {
        const init = await buildAuthInit();
        const res = await moderationApi.getPostStatus(postId, init);
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
      const runId = currentRunRef.current?.id ?? lastRunRef.current?.id;
      trackRuntimeEvent("runtime_killed", {
        capsuleId: post.capsule.id,
        artifactId: post.capsule.artifactId ?? null,
        runtimeType: post.capsule.runner ?? null,
        properties: {
          postId: post.id,
          runId,
          reason: "user_request",
        },
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
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">{post?.title}</h1>
              <Link
                to={post ? `/u/${post.author.handle}` : "#"}
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
        <PlayerShell
          ref={iframeHandleRef}
          capsuleId={post?.capsule?.id}
          artifactId={post?.capsule?.artifactId ?? undefined}
          params={capsuleParams}
          postId={postId}
          isRunning={isRunning}
          stats={stats}
          consoleEntries={consoleEntries}
          consoleCollapsed={isConsoleCollapsed}
          onConsoleToggle={() => setIsConsoleCollapsed((prev) => !prev)}
          onClearConsole={handleClearConsole}
          onRestart={handleRestart}
          onKill={handleKill}
          onShare={handleShare}
          onReady={handleRunnerReady}
          onLoading={handleRuntimeLoading}
          onError={handleRuntimeError}
          onLog={handleConsoleLog}
          onStats={handleStatsUpdate}
          onBoot={handleBootMetrics}
          isLoading={isLoading}
          loadError={error}
        />

        {/* Right: Drawer */}
        <div className="w-80">
          <PlayerDrawer
            postId={postId}
            notes={post?.description}
            remixInfo={{ changes: 0 }}
            initialTab={initialTab}
            onTabChange={handleDrawerTabChange}
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
