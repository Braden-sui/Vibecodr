"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { ArrowLeft, GitFork, Sliders } from "lucide-react";
import {
  postsApi,
  runsApi,
  moderationApi,
  recipesApi,
  remixesApi,
  workerUrl,
  type FeedPost,
  mapApiFeedPostToFeedPost,
  type RemixTreeResponse,
} from "@/lib/api";
import { trackClientError, trackEvent, trackRuntimeEvent } from "@/lib/analytics";
import { toast } from "@/lib/toast";
import type { ManifestParam } from "@vibecodr/shared/manifest";
import { readPreviewHandoff, type PreviewLogEntry } from "@/lib/handoff";
import { budgeted } from "@/lib/perf";
import {
  ApiPostResponseSchema,
  ApiRecipeCreateResponseSchema,
  ApiRecipeListResponseSchema,
  ApiRemixTreeResponseSchema,
  Plan,
  normalizePlan,
} from "@vibecodr/shared";
import { usePageMeta } from "@/lib/seo";
import { PlayerRecipesTab, type PlayerRecipeView } from "@/components/Player/PlayerRecipesTab";
import { buildEmbedCode } from "@/lib/embed";

type PlayerPageClientProps = {
  postId: string;
};

const MAX_CONSOLE_LOGS = 120;
const LOG_SAMPLE_RATE = 0.2;
const LOG_BATCH_TARGET = 10;
const PERF_SAMPLE_RATE = 0.25;
const PERF_EVENT_MIN_INTERVAL_MS = 2000;
const RUNTIME_BUDGETS = getRuntimeBudgets("player");
const CLIENT_STATIC_BOOT_BUDGET_MS = RUNTIME_BUDGETS.clientStaticBootMs;
const WEB_CONTAINER_BOOT_BUDGET_MS = RUNTIME_BUDGETS.webContainerBootMs;
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

function resolveBootBudgetMs(runner?: string | null): number {
  if (isClientStaticRunnerType(runner)) {
    return CLIENT_STATIC_BOOT_BUDGET_MS;
  }
  if (runner && runner.toLowerCase() === "webcontainer") {
    return WEB_CONTAINER_BOOT_BUDGET_MS;
  }
  return CLIENT_STATIC_BOOT_BUDGET_MS;
}
export default function PlayerPageClient({ postId }: PlayerPageClientProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ fps: 0, memory: 0, bootTime: 0 });
  const [capsuleParams, setCapsuleParams] = useState<Record<string, unknown>>({});
  const [areParamsOpen, setAreParamsOpen] = useState(false);
  const [savedRecipes, setSavedRecipes] = useState<PlayerRecipeView[]>([]);
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [isRecipesLoading, setIsRecipesLoading] = useState(false);
  const [isSavingRecipe, setIsSavingRecipe] = useState(false);
  const [busyRecipeId, setBusyRecipeId] = useState<string | null>(null);
  const [post, setPost] = useState<FeedPost | null>(null);
  const [remixTree, setRemixTree] = useState<RemixTreeResponse | null>(null);
  const [remixTreeError, setRemixTreeError] = useState<string | null>(null);
  const [isRemixTreeLoading, setIsRemixTreeLoading] = useState(false);
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
  const authHeaderRef = useRef<string | null>(null);
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
  // WHY: Prevent infinite retry loop when rate-limited. Store timestamp when cooldown expires.
  const rateLimitCooldownUntilRef = useRef<number>(0);
  const handoffPrefillAppliedRef = useRef(false);
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const navigate = useNavigate();
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
  const initialTab: "notes" | "remix" | "chat" | "recipes" =
    tabParam === "chat" || tabParam === "comments"
      ? "chat"
      : tabParam === "remix"
      ? "remix"
      : tabParam === "recipes"
      ? "recipes"
      : "notes";
  const capsuleParamDefs = post?.capsule?.params;
  const manifestParams = useMemo<ManifestParam[]>(() => {
    if (!capsuleParamDefs || !Array.isArray(capsuleParamDefs)) {
      return [];
    }
    return capsuleParamDefs.filter(isManifestParam);
  }, [capsuleParamDefs]);
  const capsuleId = post?.capsule?.id ?? null;
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
    authHeaderRef.current = `Bearer ${token}`;
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  };

  const handleDrawerTabChange = useCallback(
    (next: "notes" | "remix" | "chat" | "recipes") => {
      const current = searchParams.get("tab") ?? "notes";
      const canonical =
        next === "chat" ? "chat" : next === "remix" ? "remix" : next === "recipes" ? "recipes" : "notes";
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
      releaseRuntimeSlot(runtimeSlotRef.current, "player");
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
      const artifactId = post?.capsule?.artifactId ?? null;
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
              artifactId,
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
    [post?.capsule?.id, post?.capsule?.artifactId, post?.id]
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
      const artifactId = capsule?.artifactId ?? null;
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
        artifactId,
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

  const sendAbandonBeacon = useCallback(() => {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
    const session = currentRunRef.current;
    const currentPost = post;
    const capsule = currentPost?.capsule;
    if (!session || !capsule || !currentPost?.id) return;

    const durationMs = Math.max(0, Date.now() - session.startedAt);
    const payload = JSON.stringify({
      runId: session.id,
      capsuleId: capsule.id,
      postId: currentPost.id,
      durationMs,
      status: "failed",
      errorMessage: "page_unload",
      artifactId: capsule.artifactId ?? null,
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authHeaderRef.current) {
      headers.Authorization = authHeaderRef.current;
    }

    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon(workerUrl("/runs/complete"), blob);
    currentRunRef.current = null;
    finishedRunRef.current = { runId: session.id, status: "failed" };
  }, [post]);

  useEffect(() => {
    const handler = () => sendAbandonBeacon();
    window.addEventListener("pagehide", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      window.removeEventListener("beforeunload", handler);
    };
  }, [sendAbandonBeacon]);

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
    // INVARIANT: If rate-limited, do not retry until cooldown expires (prevents infinite 429 loop)
    if (Date.now() < rateLimitCooldownUntilRef.current) {
      return null;
    }
    const capsule = post.capsule!;
    const postId = post.id;
    if (currentRunRef.current) {
      return currentRunRef.current;
    }
    if (pendingRunStartRef.current) {
      return pendingRunStartRef.current;
    }
    const startPromise = (async () => {
      runStartInFlightRef.current = true;

      if (!runtimeSlotRef.current) {
        const reservation = reserveRuntimeSlot("player");
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
      const artifactId = capsule.artifactId ?? null;
      try {
        const init = await buildAuthInit();
        if (!init) {
          trackClientError("E-VIBECODR-0517", {
            area: "player.startRun",
            runId: provisionalRunId,
            capsuleId: capsule.id,
            postId,
            message: "Missing auth token for run start",
          });
          releaseRuntimeSlotGuard();
          return null;
        }

        const response = await runsApi.start(
          { runId: provisionalRunId, capsuleId: capsule.id, postId, artifactId },
          init
        );

      if (!response.ok) {
        let reason = `status=${response.status}`;
        let errorCode: string | undefined;
        let limit: number | undefined;
        let plan: Plan | undefined;
        let runsUsed: number | null = null;
        let maxRuns: number | null = null;
        try {
          const body = (await response.json()) as {
            reason?: string;
            code?: string;
            limit?: number;
            plan?: unknown;
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
              plan = normalizePlan(body.plan);
            }
            if (typeof body?.runsThisMonth === "number") {
              runsUsed = body.runsThisMonth;
            }
          if (typeof body?.limits?.maxRuns === "number") {
            maxRuns = body.limits.maxRuns;
          }
          if (response.status === 429) {
            // SAFETY: Set 30s cooldown to prevent infinite retry loop on rate limit
            rateLimitCooldownUntilRef.current = Date.now() + 30_000;
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
                  case Plan.FREE:
                    return "Free";
                  case Plan.CREATOR:
                    return "Creator";
                  case Plan.PRO:
                    return "Pro";
                  case Plan.TEAM:
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
                if (plan === Plan.FREE) {
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
            capsuleId: capsule.id,
            postId,
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

        const confirmation = confirmRuntimeSlot("player", runtimeSlotRef.current ?? session.id, session.id);
        runtimeSlotRef.current = confirmation.allowed ? confirmation.token : runtimeSlotRef.current;
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
      const reservation = reserveRuntimeSlot("player");
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
    const bootBudgetMs = resolveBootBudgetMs(post?.capsule?.runner ?? null);
    if (Number.isFinite(bootBudgetMs) && bootBudgetMs > 0) {
      bootTimerRef.current = window.setTimeout(() => {
        handleBudgetViolation("boot_timeout", {
          limitMs: bootBudgetMs,
          observedMs: bootBudgetMs,
        });
      }, bootBudgetMs);
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
      const bootBudgetMs = resolveBootBudgetMs(post?.capsule?.runner ?? null);
      if (budgetStateRef.current.bootStartedAt) {
        const bootElapsed = Math.max(0, Date.now() - budgetStateRef.current.bootStartedAt);
        if (bootElapsed > bootBudgetMs) {
          handleBudgetViolation("boot_timeout", {
            limitMs: bootBudgetMs,
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
      const bootBudgetMs = resolveBootBudgetMs(post?.capsule?.runner ?? null);
      if (metrics.bootTimeMs > bootBudgetMs) {
        handleBudgetViolation("boot_timeout", {
          limitMs: bootBudgetMs,
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
      // SAFETY: Only restore lastRunRef if we're not in a rate-limit cooldown
      // (prevents trying to complete a run that was never created on the backend)
      if (!currentRunRef.current && lastRunRef.current && Date.now() >= rateLimitCooldownUntilRef.current) {
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
    const capsuleId = post?.capsule?.id ?? null;
    if (!capsuleId) {
      setRemixTree(null);
      setRemixTreeError(null);
      return;
    }
    let cancelled = false;
    setIsRemixTreeLoading(true);
    setRemixTreeError(null);

    (async () => {
      try {
        const response = await remixesApi.tree(capsuleId);
        const payload = await response
          .json()
          .catch(() => ({ error: "Failed to parse remix response" }));
        if (!response.ok) {
          const message =
            payload && typeof (payload as any).error === "string"
              ? (payload as any).error
              : "Failed to load remix lineage";
          throw new Error(message);
        }
        const parsed = ApiRemixTreeResponseSchema.parse(payload);
        if (!cancelled) {
          setRemixTree(parsed);
        }
      } catch (err) {
        if (!cancelled) {
          setRemixTreeError(err instanceof Error ? err.message : "Failed to load remix lineage");
          setRemixTree(null);
        }
      } finally {
        if (!cancelled) {
          setIsRemixTreeLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [post?.capsule?.id]);

  useEffect(() => {
    if (!remixTreeError) return;
    console.warn("E-VIBECODR-REMIX-TREE player lineage fetch failed", {
      postId,
      capsuleId: post?.capsule?.id ?? null,
      error: remixTreeError,
    });
  }, [post?.capsule?.id, postId, remixTreeError]);

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
    // WHY: Try to send kill message to iframe, but always update UI state regardless of success
    const sent =
      (typeof iframeHandleRef.current?.kill === "function" && iframeHandleRef.current?.kill()) ||
      postMessageToCapsule("kill");
    finalizeRunSession("failed", "killed_by_user");
    // SAFETY: Always update UI state even if postMessage failed - the run should stop visually
    setIsRunning(false);
    setStats({ fps: 0, memory: 0, bootTime: 0 });
    if (!sent) {
      console.warn("E-VIBECODR-0530 kill message not sent but UI stopped", {
        capsuleId: post?.capsule?.id,
        postId: post?.id,
      });
    }
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

  const handleCopyEmbed = useCallback(async () => {
    if (!post || post.type !== "app") {
      return;
    }
    const currentOrigin =
      typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
    if (!currentOrigin) {
      toast({
        title: "Embed unavailable",
        description: "Unable to resolve the embed URL right now.",
        variant: "error",
      });
      trackClientError("E-VIBECODR-0513", {
        area: "player.embed",
        postId,
        reason: "missing_origin",
      });
      return;
    }
    const embedCode = buildEmbedCode(currentOrigin, postId);
    try {
      await navigator.clipboard.writeText(embedCode);
      toast({
        title: "Embed code copied",
        description: "Paste this iframe into your site to embed the vibe.",
        variant: "success",
      });
      trackEvent("embed_code_copied", {
        surface: "player",
        postId,
        capsuleId: post.capsule?.id ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trackClientError("E-VIBECODR-0514", {
        area: "player.embedClipboard",
        postId,
        message,
      });
      toast({
        title: "Copy failed",
        description: "Could not copy the embed snippet. Please try again.",
        variant: "error",
      });
    }
  }, [post, postId]);

  const handleRemix = useCallback(() => {
    if (!capsuleId) {
      return;
    }
    navigate(`/post/new?remixFrom=${encodeURIComponent(capsuleId)}`);
  }, [capsuleId, navigate]);

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

  const refreshRecipes = useCallback(async () => {
    if (!post?.capsule?.id || manifestParams.length === 0) {
      setSavedRecipes([]);
      setRecipesError(null);
      setIsRecipesLoading(false);
      return;
    }
    setIsRecipesLoading(true);
    setRecipesError(null);
    try {
      const response = await recipesApi.list(post.capsule.id, { limit: 50 });
      const raw = await response.json();
      if (!response.ok) {
        const message =
          (raw as { error?: string })?.error ?? `Failed to load recipes (status ${response.status})`;
        throw new Error(message);
      }
      const parsed = ApiRecipeListResponseSchema.parse(raw);
      const normalized = parsed.recipes.map<PlayerRecipeView>((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        params: sanitizeRecipeParamsForManifest(manifestParams, recipe.params ?? {}),
        author: {
          id: recipe.author.id,
          handle: recipe.author.handle ?? null,
          name: recipe.author.name ?? null,
          avatarUrl: recipe.author.avatarUrl ?? null,
        },
        createdAt: normalizeRecipeTimestamp(recipe.createdAt),
      }));
      normalized.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setSavedRecipes(normalized);
    } catch (err) {
      setRecipesError(err instanceof Error ? err.message : "Failed to load recipes");
    } finally {
      setIsRecipesLoading(false);
    }
  }, [manifestParams, post?.capsule?.id]);

  useEffect(() => {
    void refreshRecipes();
  }, [refreshRecipes]);

  const defaultRecipe = useMemo<PlayerRecipeView | null>(() => {
    if (!post?.capsule || manifestParams.length === 0) {
      return null;
    }
    const defaults: Record<string, RecipeValue> = {};
    for (const param of manifestParams) {
      const normalized = normalizeRecipeParamValue(param, param.default);
      defaults[param.name] = normalized !== undefined ? normalized : (param.default as RecipeValue);
    }
    return {
      id: "default",
      name: "Default (author config)",
      params: defaults,
      author: {
        id: post.author.id,
        handle: post.author.handle,
        name: post.author.name ?? null,
        avatarUrl: post.author.avatarUrl ?? null,
      },
      createdAt: null,
      isDefault: true,
    };
  }, [manifestParams, post]);

  const recipeList = useMemo<PlayerRecipeView[]>(() => {
    if (defaultRecipe) {
      return [defaultRecipe, ...savedRecipes];
    }
    return savedRecipes;
  }, [defaultRecipe, savedRecipes]);

  const handleApplyRecipe = useCallback(
    (recipe: PlayerRecipeView) => {
      if (!recipe || manifestParams.length === 0) {
        return;
      }
      const nextParams = buildParamsFromRecipe(manifestParams, recipe.params);
      setCapsuleParams(nextParams);
      toast({
        title: "Recipe applied",
        description: `Loaded "${recipe.name}"`,
      });
    },
    [manifestParams],
  );

  const handleSaveRecipe = useCallback(
    async (name: string) => {
      if (!post?.capsule?.id || manifestParams.length === 0) {
        toast({
          title: "Cannot save recipe",
          description: "This app does not expose any parameters.",
          variant: "error",
        });
        return;
      }
      if (!isSignedIn) {
        toast({
          title: "Sign in required",
          description: "Sign in to publish a recipe.",
          variant: "error",
        });
        return;
      }
      const payloadParams = sanitizeRecipeParamsForManifest(manifestParams, capsuleParams);
      if (Object.keys(payloadParams).length === 0) {
        toast({
          title: "Nothing to save",
          description: "Adjust at least one parameter before saving a recipe.",
          variant: "error",
        });
        return;
      }
      setIsSavingRecipe(true);
      try {
        const init = await buildAuthInit();
        if (!init) {
          toast({
            title: "Sign in required",
            description: "Sign in to publish a recipe.",
            variant: "error",
          });
          return;
        }
        const response = await recipesApi.create(
          post.capsule.id,
          { name, params: payloadParams },
          {
            ...init,
            headers: {
              "Content-Type": "application/json",
              ...(init.headers || {}),
            },
          },
        );
        const raw = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            (raw as { error?: string })?.error ?? `Failed to save recipe (status ${response.status})`;
          toast({
            title: "Could not save recipe",
            description: message,
            variant: "error",
          });
          return;
        }
        const parsed = ApiRecipeCreateResponseSchema.safeParse(raw);
        if (parsed.success) {
          const recipe = parsed.data.recipe;
          const sanitized: PlayerRecipeView = {
            id: recipe.id,
            name: recipe.name,
            params: sanitizeRecipeParamsForManifest(manifestParams, recipe.params ?? {}),
            author: {
              id: recipe.author.id,
              handle: recipe.author.handle ?? null,
              name: recipe.author.name ?? null,
              avatarUrl: recipe.author.avatarUrl ?? null,
            },
            createdAt: normalizeRecipeTimestamp(recipe.createdAt) ?? Math.floor(Date.now() / 1000),
          };
          setSavedRecipes((prev) => {
            const next = [sanitized, ...prev.filter((item) => item.id !== sanitized.id)];
            next.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
            return next;
          });
          setRecipesError(null);
        } else {
          await refreshRecipes();
        }
        toast({
          title: "Recipe saved",
          description: "Shared to the capsule sidebar.",
        });
      } catch (err) {
        toast({
          title: "Could not save recipe",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "error",
        });
      } finally {
        setIsSavingRecipe(false);
      }
    },
    [
      capsuleParams,
      buildAuthInit,
      isSignedIn,
      manifestParams,
      post?.capsule?.id,
      refreshRecipes,
    ],
  );

  const handleUpdateRecipe = useCallback(
    async (recipe: PlayerRecipeView) => {
      if (!post?.capsule?.id || manifestParams.length === 0) {
        toast({
          title: "Cannot update recipe",
          description: "This app does not expose any parameters.",
          variant: "error",
        });
        return;
      }
      const payloadParams = sanitizeRecipeParamsForManifest(manifestParams, capsuleParams);
      if (Object.keys(payloadParams).length === 0) {
        toast({
          title: "Nothing to save",
          description: "Adjust at least one parameter before updating.",
          variant: "error",
        });
        return;
      }
      setBusyRecipeId(recipe.id);
      try {
        const init = await buildAuthInit();
        if (!init) {
          toast({
            title: "Sign in required",
            description: "Sign in to update this recipe.",
            variant: "error",
          });
          return;
        }
        const response = await recipesApi.update(
          post.capsule.id,
          recipe.id,
          { name: recipe.name, params: payloadParams },
          {
            ...init,
            headers: {
              "Content-Type": "application/json",
              ...(init.headers || {}),
            },
          },
        );
        const raw = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            (raw as { error?: string })?.error ?? `Failed to update recipe (status ${response.status})`;
          toast({
            title: "Could not update recipe",
            description: message,
            variant: "error",
          });
          return;
        }
        const parsed = ApiRecipeCreateResponseSchema.safeParse(raw);
        if (parsed.success) {
          const updated = parsed.data.recipe;
          const sanitized: PlayerRecipeView = {
            id: updated.id,
            name: updated.name,
            params: sanitizeRecipeParamsForManifest(manifestParams, updated.params ?? {}),
            author: {
              id: updated.author.id,
              handle: updated.author.handle ?? null,
              name: updated.author.name ?? null,
              avatarUrl: updated.author.avatarUrl ?? null,
            },
            createdAt: normalizeRecipeTimestamp(updated.createdAt) ?? recipe.createdAt ?? null,
          };
          setSavedRecipes((prev) => prev.map((r) => (r.id === sanitized.id ? sanitized : r)));
          toast({
            title: "Recipe updated",
            description: `"${recipe.name}" now matches current parameters.`,
          });
        } else {
          await refreshRecipes();
        }
      } catch (err) {
        toast({
          title: "Could not update recipe",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "error",
        });
      } finally {
        setBusyRecipeId(null);
      }
    },
    [buildAuthInit, capsuleParams, manifestParams, post?.capsule?.id, refreshRecipes],
  );

  const handleDeleteRecipe = useCallback(
    async (recipe: PlayerRecipeView) => {
      if (!post?.capsule?.id) return;
      setBusyRecipeId(recipe.id);
      try {
        const init = await buildAuthInit();
        if (!init) {
          toast({
            title: "Sign in required",
            description: "Sign in to delete this recipe.",
            variant: "error",
          });
          return;
        }
        const response = await recipesApi.delete(post.capsule.id, recipe.id, init);
        if (!response.ok) {
          const raw = await response.json().catch(() => null);
          const message =
            (raw as { error?: string })?.error ?? `Failed to delete recipe (status ${response.status})`;
          toast({
            title: "Could not delete recipe",
            description: message,
            variant: "error",
          });
          return;
        }
        setSavedRecipes((prev) => prev.filter((r) => r.id !== recipe.id));
        toast({
          title: "Recipe deleted",
          description: `"${recipe.name}" was removed.`,
          variant: "success",
        });
      } catch (err) {
        toast({
          title: "Could not delete recipe",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "error",
        });
      } finally {
        setBusyRecipeId(null);
      }
    },
    [buildAuthInit, post?.capsule?.id],
  );

  const recipesTabContent = useMemo(() => {
    if (!post?.capsule || manifestParams.length === 0) {
      return null;
    }
    return (
      <PlayerRecipesTab
        recipes={recipeList}
        isLoading={isRecipesLoading}
        isSaving={isSavingRecipe}
        canSave={!!isSignedIn}
        busyRecipeId={busyRecipeId}
        error={recipesError}
        onSave={handleSaveRecipe}
        onApply={handleApplyRecipe}
        onUpdate={handleUpdateRecipe}
        onDelete={handleDeleteRecipe}
        onRefresh={refreshRecipes}
      />
    );
  }, [
    post?.capsule,
    manifestParams,
    recipeList,
    isRecipesLoading,
    isSavingRecipe,
    isSignedIn,
    busyRecipeId,
    recipesError,
    handleSaveRecipe,
    handleApplyRecipe,
    handleUpdateRecipe,
    handleDeleteRecipe,
    refreshRecipes,
  ]);

  const remixNode =
    remixTree && capsuleId
      ? remixTree.nodes.find((node) => node.capsuleId === capsuleId)
      : null;
  const remixParentNode =
    remixTree && remixTree.directParentId
      ? remixTree.nodes.find((node) => node.capsuleId === remixTree.directParentId)
      : null;
  const remixDrawerInfo =
    capsuleId || remixTree
          ? {
              parentId: remixTree?.directParentId ?? null,
              parentTitle: remixParentNode?.title ?? null,
              parentHandle: remixParentNode?.authorHandle ?? null,
              parentPostId: remixParentNode?.postId ?? null,
              remixCount: remixNode?.remixCount ?? post?.stats.remixes ?? 0,
              treeUrl: capsuleId ? `/vibe/${encodeURIComponent(capsuleId)}/remixes` : undefined,
            }
          : undefined;

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
                {post.type === "app"
                  ? post.capsule?.runner || "client-static"
                  : `${post.type.charAt(0).toUpperCase()}${post.type.slice(1)}`}
              </Badge>
            )}
            {capsuleId && (
              <Button asChild variant="outline" size="sm" className="gap-1">
                <Link to={`/vibe/${encodeURIComponent(capsuleId)}/remixes`}>
                  <GitFork className="h-4 w-4" />
                  Family tree
                </Link>
              </Button>
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
          onCopyEmbed={post?.type === "app" ? handleCopyEmbed : undefined}
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
            remixInfo={remixDrawerInfo}
            remixInfoLoading={isRemixTreeLoading}
            remixInfoError={remixTreeError}
            recipesContent={recipesTabContent}
            initialTab={initialTab}
            onTabChange={handleDrawerTabChange}
            onRemix={capsuleId ? handleRemix : undefined}
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

type RecipeValue = string | number | boolean;

const PARAM_TYPES: ManifestParam["type"][] = ["slider", "toggle", "select", "text", "color", "number"];

function clampRecipeNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === "number") {
    next = Math.max(min, next);
  }
  if (typeof max === "number") {
    next = Math.min(max, next);
  }
  return next;
}

function normalizeRecipeParamValue(param: ManifestParam, raw: unknown): RecipeValue | undefined {
  switch (param.type) {
    case "slider":
    case "number":
      if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
      return clampRecipeNumber(raw, param.min, param.max);
    case "toggle":
      return typeof raw === "boolean" ? raw : undefined;
    case "select":
      if (typeof raw !== "string") return undefined;
      return param.options && param.options.includes(raw) ? raw : undefined;
    case "text":
      if (typeof raw !== "string") return undefined;
      return raw.slice(0, Math.min(Math.max(param.maxLength ?? 400, 1), 1000));
    case "color":
      if (typeof raw !== "string") return undefined;
      return raw.slice(0, 64);
    default:
      if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        return raw;
      }
      return undefined;
  }
}

function sanitizeRecipeParamsForManifest(
  manifestParams: ManifestParam[],
  params: Record<string, unknown> | null | undefined
): Record<string, RecipeValue> {
  if (!params || typeof params !== "object") {
    return {};
  }

  const manifestByName = new Map<string, ManifestParam>();
  for (const param of manifestParams) {
    manifestByName.set(param.name, param);
  }

  const sanitized: Record<string, RecipeValue> = {};
  for (const [name, raw] of Object.entries(params)) {
    const def = manifestByName.get(name);
    if (!def) continue;
    const normalized = normalizeRecipeParamValue(def, raw);
    if (normalized !== undefined) {
      sanitized[name] = normalized;
    }
  }
  return sanitized;
}

function buildParamsFromRecipe(
  manifestParams: ManifestParam[],
  params: Record<string, RecipeValue>
): Record<string, RecipeValue> {
  const next: Record<string, RecipeValue> = {};
  for (const param of manifestParams) {
    if (Object.prototype.hasOwnProperty.call(params, param.name)) {
      next[param.name] = params[param.name];
    } else {
      next[param.name] = param.default as RecipeValue;
    }
  }
  return next;
}

function normalizeRecipeTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

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
