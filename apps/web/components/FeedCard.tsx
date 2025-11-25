"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion } from "motion/react";
import { Link, useNavigate } from "react-router-dom";
import { CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import VibeCard from "@/src/components/VibeCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Play,
  GitFork,
  MessageCircle,
  Heart,
  Share2,
  Cpu,
  Sliders,
  Loader2,
  MoreHorizontal,
  ShieldAlert,
  Trash2,
  Wifi,
  Database,
  Sparkles,
  ArrowRight,
  Image as ImageIcon,
  Link2,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { redirectToSignIn } from "@/lib/client-auth";
import { toast } from "@/lib/toast";
import { artifactsApi, capsulesApi, moderationApi, postsApi, usersApi } from "@/lib/api";
import { ReportButton } from "@/components/ReportButton";
import { useUser, useAuth } from "@clerk/clerk-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FeedPost } from "@/lib/api";
import { budgeted } from "@/lib/perf";
import { budgetedAsync } from "@/lib/perf";
import { writePreviewHandoff, type PreviewLogEntry } from "@/lib/handoff";
import { loadRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";
import { trackClientError } from "@/lib/analytics";
import { useReducedMotion } from "@/lib/useReducedMotion";

type PublicMetadata = {
  role?: string;
  isModerator?: boolean;
} | null;

export interface FeedCardProps {
  post: FeedPost;
  onTagClick?: (tag: string) => void;
}

// Global concurrency cap for active previews
let activePreviewCount = 0;
const MAX_ACTIVE_PREVIEWS = 2;
const PREVIEW_KILL_MS = 6_000;
const PREVIEW_KILL_WARN_MS = 3_000;
const PREVIEW_GUARD_URL = "/runtime-assets/v0.1.0/guard.js";

// Global cap for manifest preloads to avoid stampedes
let manifestPreloadsInFlight = 0;
const MAX_MANIFEST_PREFETCH = 3;
const PREVIEW_LOG_LIMIT = 40;

function toOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function resolveRunnerOrigins(capsuleId?: string, artifactId?: string | null): string[] {
  if (!capsuleId) return [];
  const origins = new Set<string>();
  const bundleOrigin = toOrigin(
    artifactId ? artifactsApi.bundleSrc(artifactId) : capsulesApi.bundleSrc(capsuleId)
  );
  const runtimeCdnOrigin = toOrigin(process.env.NEXT_PUBLIC_RUNTIME_CDN_ORIGIN);

  if (bundleOrigin) {
    origins.add(bundleOrigin);
  }
  if (runtimeCdnOrigin) {
    origins.add(runtimeCdnOrigin);
  }

  return Array.from(origins);
}

function buildPreviewSrcDoc(bundleUrl: string): string {
  const escapedBundle = bundleUrl.replace(/"/g, "&quot;");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <script src="${PREVIEW_GUARD_URL}"></script>
    <script>
      (async () => {
        try {
          const res = await fetch("${escapedBundle}", { cache: "no-store" });
          const html = await res.text();
          document.open();
          document.write(html);
          document.close();
        } catch (err) {
          document.body.innerText = "Preview failed to load.";
          console.error("E-VIBECODR-0999 preview guard fetch failed", err);
        }
      })();
    </script>
  </head>
  <body></body>
</html>`;
}

export function FeedCard({ post, onTagClick }: FeedCardProps) {
  const navigate = useNavigate();
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isModeratorFlag = metadata?.isModerator === true;
  const isModeratorOrAdmin =
    !!user && isSignedIn && (role === "admin" || role === "moderator" || isModeratorFlag);
  const actorId = user?.id ?? null;
  const isApp = post.type === "app";
  const isImage = post.type === "image";
  const isLink = post.type === "link";
  const isLongform = post.type === "longform";
  const detailHref = isApp ? `/player/${post.id}` : `/post/${post.id}`;
  const descriptionClamp = isLongform ? "line-clamp-3" : "line-clamp-2";
  const [_isHovering, setIsHovering] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewErrorMessage, setPreviewErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const prebootStartRef = useRef<number>();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [_isWarmZoneActive, setIsWarmZoneActive] = useState(false);
  const preconnectHintedRef = useRef(false);
  const clickRunIncrementRef = useRef(false);
  const pauseStateRef = useRef<"paused" | "running">("running");
  const lastIntersectionRatioRef = useRef(1);
  const [isModerating, setIsModerating] = useState(false);
  const previewTimeoutRef = useRef<number | null>(null);
  const previewCountdownIntervalRef = useRef<number | null>(null);
  const previewBootDeadlineRef = useRef<number | null>(null);
  const previewTimeoutWarnedRef = useRef(false);
  const previewRetryRef = useRef(false);
  const [bootCountdownMs, setBootCountdownMs] = useState<number | null>(null);
  const [authzState, setAuthzState] = useState<"unknown" | "unauthenticated" | "forbidden" | "authorized">("unknown");
  const previewLogsRef = useRef<PreviewLogEntry[]>([]);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    previewLogsRef.current = [];
  }, [post.id]);

  useEffect(() => {
    setLiked(post.viewer?.liked ?? false);
    setLikeCount(post.stats.likes);
    setIsFollowingAuthor(post.viewer?.followingAuthor ?? false);
  }, [post.id, post.stats.likes, post.viewer?.liked, post.viewer?.followingAuthor]);

  const pushPreviewLog = useCallback(
    (entry: { level: PreviewLogEntry["level"]; message: string; timestamp?: number }) => {
      const normalized: PreviewLogEntry = {
        level: entry.level,
        message: entry.message.slice(0, 500),
        timestamp: entry.timestamp ?? Date.now(),
      };
      previewLogsRef.current = [...previewLogsRef.current, normalized].slice(-PREVIEW_LOG_LIMIT);
    },
    []
  );

  const resetPreviewTimers = useCallback(() => {
    if (previewTimeoutRef.current !== null) {
      window.clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    if (previewCountdownIntervalRef.current !== null) {
      window.clearInterval(previewCountdownIntervalRef.current);
      previewCountdownIntervalRef.current = null;
    }
    previewBootDeadlineRef.current = null;
    previewTimeoutWarnedRef.current = false;
    setBootCountdownMs(null);
  }, []);

  useEffect(() => {
    if (!isRunning || previewLoaded) {
      resetPreviewTimers();
      return;
    }

    const deadline = Date.now() + PREVIEW_KILL_MS;
    previewBootDeadlineRef.current = deadline;
    previewTimeoutWarnedRef.current = false;
    setBootCountdownMs(PREVIEW_KILL_MS);

    const handleBootTimeout = () => {
      setPreviewErrorMessage(
        "Preview stopped because it took too long to start. Open the player for a full run."
      );
      setIsRunning(false);
      pushPreviewLog({
        level: "error",
        message: `Preview launch timed out after ${PREVIEW_KILL_MS}ms`,
      });
      if (clickRunIncrementRef.current) {
        activePreviewCount = Math.max(0, activePreviewCount - 1);
        clickRunIncrementRef.current = false;
      }
      if (!previewRetryRef.current) {
        previewRetryRef.current = true;
        window.setTimeout(() => {
          previewRetryRef.current = false;
        }, 500);
      }
      resetPreviewTimers();
    };

    previewTimeoutRef.current = window.setTimeout(handleBootTimeout, PREVIEW_KILL_MS);

    const updateCountdown = () => {
      if (!previewBootDeadlineRef.current) return;
      const remaining = previewBootDeadlineRef.current - Date.now();
      setBootCountdownMs(Math.max(0, remaining));
      if (remaining <= PREVIEW_KILL_WARN_MS && remaining > 0 && !previewTimeoutWarnedRef.current) {
        previewTimeoutWarnedRef.current = true;
        toast({
          title: "Preview stopping in 3s...",
          description:
            "Starting the preview is taking longer than expected. Open the player for a full run without limits.",
          variant: "warning",
        });
      }
    };

    updateCountdown();
    previewCountdownIntervalRef.current = window.setInterval(updateCountdown, 200);

    return resetPreviewTimers;
  }, [isRunning, previewLoaded, pushPreviewLog, resetPreviewTimers]);

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

  useEffect(() => {
    if (!isSignedIn) {
      setAuthzState("unauthenticated");
    } else if (!isModeratorOrAdmin) {
      setAuthzState("forbidden");
    } else {
      setAuthzState("authorized");
    }
  }, [isSignedIn, isModeratorOrAdmin]);

  const handleModerationAction = async (action: "quarantine" | "remove") => {
    if (isModerating) return;
    if (authzState !== "authorized") {
      toast({
        title: "Not authorized",
        description: "Moderator or admin access is required to perform this action.",
        variant: "error",
      });
      return;
    }

    setIsModerating(true);
    try {
      const init = await buildAuthInit();
      if (!init) {
        setAuthzState("unauthenticated");
        throw new Error("Authentication is required to perform moderation actions.");
      }
      const notes = `source=feed_card | action=${action} | target=post:${post.id}${actorId ? ` | actor=${actorId}` : ""}`;
      const response = await moderationApi.moderatePost(post.id, action, init, notes);

      if (!response.ok) {
        if (response.status === 403) {
          toast({ title: "Forbidden", description: "You don't have moderator access.", variant: "error" });
        } else if (response.status === 503) {
          toast({
            title: "Unavailable",
            description: "Moderation service is temporarily unavailable.",
            variant: "warning",
          });
        } else {
          let errorBody: any = null;
          try {
            errorBody = await response.json();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (typeof console !== "undefined" && typeof console.error === "function") {
              console.error("E-VIBECODR-0107 moderation action error JSON parse failed", {
                postId: post.id,
                status: response.status,
                error: message,
              });
            }
            trackClientError("E-VIBECODR-0107", {
              area: "feed.moderationAction",
              action,
              postId: post.id,
              status: response.status,
              message,
            });
          }
          const description =
            errorBody && typeof errorBody.error === "string"
              ? errorBody.error
              : "Failed to apply moderation action";
          toast({ title: "Failed", description, variant: "error" });
        }
        return;
      }

      window.location.reload();
    } catch (error) {
      console.error("Moderation action failed:", error);
      toast({ title: "Failed", description: error instanceof Error ? error.message : "Moderation action failed", variant: "error" });
    } finally {
      setIsModerating(false);
    }
  };

  const persistPreviewHandoff = useCallback(
    (source: string) => {
      writePreviewHandoff(post.id, {
        source,
        logs: previewLogsRef.current,
      });
    },
    [post.id]
  );

  const capsuleId = post.capsule?.id;
  const encodedCapsuleId = capsuleId ? encodeURIComponent(capsuleId) : null;
  const artifactId = post.capsule?.artifactId ?? null;
  const isWebContainer = post.capsule?.runner === "webcontainer";
  // Note: WebContainer runner should support equivalent pause/resume semantics when inline runs are enabled.
  const bundleUrl = useMemo(
    () => (artifactId ? artifactsApi.bundleSrc(artifactId) : capsuleId ? capsulesApi.bundleSrc(capsuleId) : ""),
    [artifactId, capsuleId]
  );
  const previewSrcDoc = useMemo(() => {
    return bundleUrl ? buildPreviewSrcDoc(bundleUrl) : undefined;
  }, [bundleUrl]);
  const runnerOrigins = useMemo(
    () => resolveRunnerOrigins(capsuleId, artifactId),
    [artifactId, capsuleId]
  );
  const runnerOriginWarnedRef = useRef(false);
  const typeBadge = useMemo(() => {
    switch (post.type) {
      case "app":
        return { icon: <Cpu className="h-3 w-3" />, label: post.capsule?.runner || "App" };
      case "image":
        return { icon: <ImageIcon className="h-3 w-3" />, label: "Image" };
      case "link":
        return { icon: <Link2 className="h-3 w-3" />, label: "Link" };
      case "longform":
        return { icon: <FileText className="h-3 w-3" />, label: "Longform" };
      case "thought":
      default:
        return { icon: <Sparkles className="h-3 w-3" />, label: "Thought" };
    }
  }, [post.capsule?.runner, post.type]);
  const coverLabel = useMemo(() => {
    if (!post.coverKey) return null;
    const segments = post.coverKey.split("/");
    return segments[segments.length - 1] || post.coverKey;
  }, [post.coverKey]);
  const primaryLink = useMemo(() => {
    if (!post.description) return null;
    const match = post.description.match(/https?:\/\/\S+/i);
    return match ? match[0] : null;
  }, [post.description]);
  const primaryLinkHost = useMemo(() => {
    if (!primaryLink) return null;
    try {
      return new URL(primaryLink).host;
    } catch {
      return primaryLink;
    }
  }, [primaryLink]);
  const displayDescription = useMemo(() => {
    if (isLink && primaryLink && post.description) {
      const cleaned = post.description.replace(primaryLink, "").trim();
      return cleaned.length > 0 ? cleaned : null;
    }
    return post.description;
  }, [isLink, post.description, primaryLink]);

  const warnMissingRunnerOrigins = useCallback(
    (context: "send" | "receive") => {
      if (runnerOriginWarnedRef.current) {
        return;
      }
      runnerOriginWarnedRef.current = true;
      console.warn("E-VIBECODR-0523 runner origin allowlist empty", {
        capsuleId,
        context,
      });
    },
    [capsuleId]
  );

  const sendRunnerControl = useCallback(
    (command: "pause" | "resume") => {
      const target = iframeRef.current?.contentWindow;
      if (!target || !capsuleId) {
        return false;
      }
      if (runnerOrigins.length === 0) {
        warnMissingRunnerOrigins("send");
        return false;
      }
      for (const origin of runnerOrigins) {
        target.postMessage({ type: command }, origin);
      }
      return true;
    },
    [capsuleId, runnerOrigins, warnMissingRunnerOrigins]
  );

  // Track when the card enters the viewport with some padding
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        budgeted(`[feed] view_io:${post.id}`, () => {
          const entry = entries[0];
          if (!entry) return;

          setIsNearViewport((prev) => (prev === entry.isIntersecting ? prev : entry.isIntersecting));
          const warmZone = entry.intersectionRatio >= 0.35;
          setIsWarmZoneActive((prev) => (prev === warmZone ? prev : warmZone));
        });
      },
      {
        root: null,
        rootMargin: "300px 0px 300px 0px",
        threshold: [0, 0.35],
      }
    );

    observer.observe(node as Element);

    return () => {
      observer.disconnect();
    };
  }, [post.id]);

  // Fire preconnect hints once a card is near the viewport
  useEffect(() => {
    if (!isNearViewport || preconnectHintedRef.current) {
      return;
    }
    preconnectHintedRef.current = true;

    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const existing = document.querySelector('link[data-feed-preconnect="capsule-prewarm"]');
    if (existing) {
      return;
    }

    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = window.location.origin;
    link.crossOrigin = "anonymous";
    link.setAttribute("data-feed-preconnect", "capsule-prewarm");
    document.head.appendChild(link);
  }, [isNearViewport]);

  // We no longer prefetch manifests per-card; manifest data arrives with the feed.
  // Preload runtime manifest for artifact-based runners when card nears viewport.
  const manifestPrefetchedRef = useRef(false);
  useEffect(() => {
    if (!isNearViewport || manifestPrefetchedRef.current) return;
    const artifactId = post.capsule?.artifactId ?? null;
    if (!artifactId) return;
    if (manifestPreloadsInFlight >= MAX_MANIFEST_PREFETCH) return;

    manifestPrefetchedRef.current = true;
    manifestPreloadsInFlight++;
    void budgetedAsync(`[feed] manifest_preload:${post.id}`, async () => {
      try {
        await loadRuntimeManifest(String(artifactId));
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("E-VIBECODR-0206 feed manifest preload failed", {
            artifactId: String(artifactId),
            postId: post.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        // soft-fail: rely on Player to surface errors
      } finally {
        manifestPreloadsInFlight = Math.max(0, manifestPreloadsInFlight - 1);
      }
    });

    return () => {
      // No-op cleanup; preload is best-effort and managed via global counter.
    };
  }, [isNearViewport, post.capsule?.artifactId, post.id]);

  useEffect(() => {
    return () => {
      if (clickRunIncrementRef.current) {
        activePreviewCount = Math.max(0, activePreviewCount - 1);
        clickRunIncrementRef.current = false;
      }
    };
  }, []);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof window === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        budgeted(`[feed] pause_resume_io:${post.id}`, () => {
          const entry = entries[0];
          if (!entry) return;

          const iframeWindow = iframeRef.current?.contentWindow;
          if (!iframeWindow || !capsuleId || !isRunning) {
            return;
          }

          const ratio = entry.intersectionRatio;
          lastIntersectionRatioRef.current = ratio;

          const hidden = typeof document !== "undefined" && document.hidden;
          const shouldPause = hidden || ratio < 0.3;
          const nextState: "paused" | "running" = shouldPause ? "paused" : "running";
          if (nextState === pauseStateRef.current) {
            return;
          }
          const sent = sendRunnerControl(nextState === "paused" ? "pause" : "resume");
          if (!sent) {
            return;
          }
          pauseStateRef.current = nextState;
        });
      },
      {
        root: null,
        rootMargin: "0px",
        threshold: [0.3],
      }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [isRunning, capsuleId, post.id, sendRunnerControl]);

  useEffect(() => {
    const onVisibility = () => {
      budgeted(`[feed] visibility_change:${post.id}`, () => {
        const target = iframeRef.current?.contentWindow;
        if (!isRunning || !target || !capsuleId) {
          return;
        }
        const ratio = lastIntersectionRatioRef.current;
        const hidden = document.hidden;
        const shouldPause = hidden || ratio < 0.3;
        const nextState: "paused" | "running" = shouldPause ? "paused" : "running";
        if (nextState === pauseStateRef.current) {
          return;
        }
        const sent = sendRunnerControl(nextState === "paused" ? "pause" : "resume");
        if (!sent) {
          return;
        }
        pauseStateRef.current = nextState;
      });
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [capsuleId, isRunning, post.id, sendRunnerControl]);

  useEffect(() => {
    if (!isApp || !capsuleId) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      if (runnerOrigins.length === 0) {
        warnMissingRunnerOrigins("receive");
        return;
      }
      if (!runnerOrigins.includes(event.origin)) {
        return;
      }
      const data = event.data;
      if (!data || typeof data.type !== "string") {
        return;
      }

      if (data.type === "log" && data.payload) {
        const payload = data.payload as { level?: string; message?: string; timestamp?: number };
        const level = payload.level;
        const normalizedLevel: PreviewLogEntry["level"] =
          level === "warn" || level === "error" || level === "info" ? level : "log";
        const message = typeof payload.message === "string" ? payload.message : JSON.stringify(payload);
        pushPreviewLog({ level: normalizedLevel, message, timestamp: payload.timestamp });
      } else if (data.type === "error") {
        const payload = data.payload as { message?: string };
        pushPreviewLog({
          level: "error",
          message: payload?.message || "Runtime error",
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [capsuleId, isApp, pushPreviewLog, runnerOrigins, warnMissingRunnerOrigins]);



  // Handle hover enter with debounce
  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(true);
    }, 300); // 300ms debounce before preboot
  };

  // Handle hover leave
  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setIsHovering(false);
  };

  // Handle click to run
  const handleClickToRun = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Check concurrency cap
    if (activePreviewCount >= MAX_ACTIVE_PREVIEWS && !isRunning) {
      // Redirect to full player if too many active previews
      toast({
        title: "Preview limit reached",
        description: "Only two inline previews can run at once. Opening the player instead.",
        variant: "warning",
      });
      window.location.href = `/player/${post.id}`;
      return;
    }

    prebootStartRef.current = Date.now();
    setPreviewErrorMessage(null);
    setPreviewLoaded(false);
    resetPreviewTimers();
    setIsRunning(true);
    if (!previewLoaded) {
      activePreviewCount++;
      clickRunIncrementRef.current = true;
    }
  };

  // Optimistic UI state for like
  const [liked, setLiked] = useState(post.viewer?.liked ?? false);
  const [likeCount, setLikeCount] = useState(post.stats.likes);
  const [isLiking, setIsLiking] = useState(false);
  // Optimistic follow state for author
  const [isFollowingAuthor, setIsFollowingAuthor] = useState(post.viewer?.followingAuthor ?? false);
  const [isFollowMutating, setIsFollowMutating] = useState(false);

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isLiking) return;
    if (!isSignedIn) {
      redirectToSignIn();
      return;
    }

    // Optimistic update
    const wasLiked = liked;
    const prevCount = likeCount;
    setLiked(!wasLiked);
    setLikeCount((prev) => (wasLiked ? Math.max(0, prev - 1) : prev + 1));
    setIsLiking(true);

    try {
      const init = await buildAuthInit();
      const response = wasLiked
        ? await postsApi.unlike(post.id, init)
        : await postsApi.like(post.id, init);

      if (response.status === 401) {
        redirectToSignIn();
        throw new Error("Unauthorized");
      }

      if (!response.ok) {
        throw new Error("Failed to like post");
      }
    } catch (error) {
      // Revert on error
      setLiked(wasLiked);
      setLikeCount(prevCount);
      console.error("Failed to like post:", error);
    } finally {
      setIsLiking(false);
    }
  };

  const handleFollowToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isFollowMutating) return;

    if (!isSignedIn) {
      redirectToSignIn();
      return;
    }

    if (!user || user.id === post.author.id) {
      return;
    }

    const nextState = !isFollowingAuthor;
    setIsFollowMutating(true);
    setIsFollowingAuthor(nextState);

    try {
      const init = await buildAuthInit();
      const response = nextState
        ? await usersApi.follow(post.author.id, init)
        : await usersApi.unfollow(post.author.id, init);

      if (response.status === 401) {
        redirectToSignIn();
        throw new Error("Unauthorized");
      }

      if (!response.ok) {
        throw new Error("Failed to update follow");
      }
    } catch (error) {
      console.error("Failed to toggle follow:", error);
      setIsFollowingAuthor(!nextState);
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Unable to update follow right now",
        variant: "error",
      });
    } finally {
      setIsFollowMutating(false);
    }
  };

  const handleComment = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    persistPreviewHandoff("comments");
    if (isApp) {
      navigate(`/player/${post.id}?tab=comments`);
    } else {
      navigate(`/post/${post.id}`);
    }
  };

  const handleRemix = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isApp && capsuleId) {
      navigate(`/post/new?remixFrom=${capsuleId}`);
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const path = isApp ? `/player/${post.id}` : `/post/${post.id}`;
    const url = `${window.location.origin}${path}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: post.title,
          text: post.description,
          url,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (typeof console !== "undefined" && typeof console.debug === "function") {
          console.debug("E-VIBECODR-0502 feed share failed or was cancelled", {
            postId: post.id,
            error: message,
          });
        }
        trackClientError("E-VIBECODR-0502", {
          area: "feed.share",
          postId: post.id,
          message,
        });
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast({
          title: "Link copied",
          description: "Share link copied to clipboard.",
          variant: "success",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("E-VIBECODR-0503 feed clipboard write failed", {
            postId: post.id,
            error: message,
          });
        }
        trackClientError("E-VIBECODR-0503", {
          area: "feed.shareClipboard",
          postId: post.id,
          message,
        });
        toast({
          title: "Copy failed",
          description: "Unable to copy share link. You can copy from the address bar instead.",
          variant: "error",
        });
      }
    }
  };

  return (
    <VibeCard
      ref={cardRef}
      className="group relative overflow-hidden rounded-2xl vc-glass shadow-vc-soft transition-all duration-200 hover:shadow-vc-soft-lg p-0"
      initial={prefersReducedMotion ? undefined : { opacity: 0.98, y: 8 }}
      whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Cover/Preview Area (apps only) */}
      {isApp && (
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="relative"
        >
          <Link to={detailHref} onClick={() => persistPreviewHandoff("cover")}>
            <div
              className={cn(
                "relative aspect-video w-full overflow-hidden bg-gradient-to-br",
                "from-blue-500/10 to-purple-500/10"
              )}
            >
              {/* Preview iframe for running apps */}
              {isRunning && capsuleId && (
                <div className="absolute inset-0 z-10">
                  <iframe
                    ref={iframeRef}
                    srcDoc={previewSrcDoc}
                    src={bundleUrl}
                    className="h-full w-full border-0"
                    title={`Preview for ${post.title}`}
                    sandbox="allow-scripts"
                    // SECURITY: allow-scripts only; allow-same-origin removed per SOTP audit
                    // Capsules use postMessage for parent communication, not same-origin APIs
                    data-runtime-network-mode={process.env.NEXT_PUBLIC_RUNTIME_BUNDLE_NETWORK_MODE || "offline"}
                    style={{
                      colorScheme: "normal",
                    }}
                    onLoad={() => {
                      const bootTime = Date.now() - (prebootStartRef.current || Date.now());
                      if (bootTime > (isWebContainer ? 1500 : 1000)) {
                        console.warn(
                          `Preview exceeded ${isWebContainer ? "WebContainer" : "client-static"} budget: ${bootTime}ms`
                        );
                      }
                      if (clickRunIncrementRef.current) {
                        activePreviewCount = Math.max(0, activePreviewCount - 1);
                        clickRunIncrementRef.current = false;
                      }
                      if (!previewLoaded) {
                        setPreviewLoaded(true);
                      }
                    }}
                    onError={() => {
                      setPreviewErrorMessage(
                        "Preview failed to load here. Open the player to run without a time limit."
                      );
                      setIsRunning(false);
                      pushPreviewLog({
                        level: "error",
                        message: "Preview iframe failed to load",
                      });
                      resetPreviewTimers();
                      if (clickRunIncrementRef.current) {
                        activePreviewCount = Math.max(0, activePreviewCount - 1);
                        clickRunIncrementRef.current = false;
                      }
                    }}
                  />
                </div>
              )}

              {/* Preview canvas or cover image */}
              {!isRunning && (
                <div className="flex h-full items-center justify-center">
                  <Button
                    onClick={handleClickToRun}
                    variant="secondary"
                    size="lg"
                    className="gap-2"
                  >
                    <Play className="h-5 w-5" />
                    Run Preview
                  </Button>
                  {previewError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/5">
                      <p className="text-sm text-destructive">Preview unavailable</p>
                    </div>
                  )}
                </div>
              )}

              {/* Hover overlay */}
              {!isRunning && (
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
              )}

              {/* WebContainer skeleton during boot */}
              {isWebContainer && isRunning && !previewLoaded && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/95">
                  <div className="text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Booting WebContainer...</p>
                  </div>
                </div>
              )}
            </div>
          </Link>
        </div>
      )}

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-1">
            <Link to={detailHref} onClick={() => persistPreviewHandoff("title")}>
              <h3 className="line-clamp-2 font-semibold leading-tight hover:text-primary">
                {post.title}
              </h3>
            </Link>
            {displayDescription && (
              <p className={cn("text-sm text-muted-foreground", descriptionClamp)}>
                {displayDescription}
              </p>
            )}
          </div>
          {isModeratorOrAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isModerating}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={isModerating}
                  onClick={async () => {
                    await handleModerationAction("quarantine");
                  }}
                >
                  <ShieldAlert className="mr-2 h-4 w-4" />
                  Quarantine post
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isModerating}
                  className="text-destructive focus:text-destructive"
                  onClick={async () => {
                    const confirmed = window.confirm("Remove this post? This cannot be undone.");
                    if (!confirmed) return;
                    await handleModerationAction("remove");
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove post
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Author */}
        <div className="flex items-center justify-between gap-2">
          <Link
            to={`/u/${post.author.handle}`}
            className="flex items-center gap-2 text-sm hover:underline"
          >
            <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-500" />
            <span className="font-medium">@{post.author.handle}</span>
          </Link>
          {post.author.id !== user?.id && (
            <Button
              size="sm"
              variant={isFollowingAuthor ? "outline" : "secondary"}
              className="h-7 px-3 text-xs"
              disabled={isFollowMutating}
              onClick={handleFollowToggle}
              aria-pressed={isFollowingAuthor}
            >
              {isFollowMutating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isFollowingAuthor ? (
                "Following"
              ) : (
                "Follow"
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pb-3">
        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="gap-1">
            {typeBadge.icon}
            {typeBadge.label}
          </Badge>

          {isApp && post.capsule?.params && post.capsule.params.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <Sliders className="h-3 w-3" />
              {post.capsule.params.length} params
            </Badge>
          )}

          {isApp && Array.isArray(post.capsule?.capabilities?.net) && post.capsule.capabilities.net.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <Wifi className="h-3 w-3" />
              <span>Network</span>
            </Badge>
          )}

          {isApp && post.capsule?.capabilities?.storage && (
            <Badge variant="outline" className="gap-1">
              <Database className="h-3 w-3" />
              Storage
            </Badge>
          )}

          {post.stats.remixes > 0 && (
            <Badge variant="outline" className="gap-1">
              <GitFork className="h-3 w-3" />
              Remix
            </Badge>
          )}

          {isLink && primaryLinkHost && (
            <Badge variant="outline" className="gap-1">
              <Link2 className="h-3 w-3" />
              {primaryLinkHost}
            </Badge>
          )}
        </div>

        {isImage && (
          <div className="mt-3 overflow-hidden rounded-lg border bg-muted/60">
            <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
              <ImageIcon className="h-4 w-4" />
              <span>{coverLabel ? `Image: ${coverLabel}` : "Image attached"}</span>
            </div>
          </div>
        )}

        {isLink && primaryLink && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border bg-muted/60 px-3 py-2 text-sm">
            <Link2 className="h-4 w-4 text-primary" />
            <a
              href={primaryLink}
              target="_blank"
              rel="noreferrer"
              className="truncate font-semibold text-primary hover:underline"
            >
              {primaryLinkHost ?? primaryLink}
            </a>
          </div>
        )}

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {post.tags.slice(0, 3).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onTagClick?.(tag)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted/80"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        {isApp && capsuleId && (
          <div className="mt-3 flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <GitFork className="h-4 w-4 text-primary" />
              <span>
                {post.stats.remixes} remix{post.stats.remixes === 1 ? "" : "es"}
              </span>
            </div>
            <Link
              to={`/vibe/${encodedCapsuleId ?? capsuleId}/remixes`}
              onClick={() => persistPreviewHandoff("remix-tree")}
              className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              View family tree
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}
      </CardContent>

      <CardFooter className="justify-between border-t pt-3">
        {/* Actions */}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <button
            onClick={handleLike}
            disabled={isLiking}
            className={cn(
              "flex items-center gap-1 transition-colors hover:text-foreground",
              liked && "text-red-500 hover:text-red-600"
            )}
          >
            <Heart className={cn("h-4 w-4", liked && "fill-current")} />
            <span>{likeCount}</span>
          </button>
          <button
            onClick={handleComment}
            className="flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <MessageCircle className="h-4 w-4" />
            <span>{post.stats.comments}</span>
          </button>
          {isApp && (
            <span className="flex items-center gap-1">
              <Play className="h-4 w-4" />
              <span>{post.stats.runs}</span>
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <ReportButton targetType="post" targetId={post.id} variant="icon" />
          <Button variant="ghost" size="icon" onClick={handleShare}>
            <Share2 className="h-4 w-4" />
          </Button>
          {isApp && (
            <Button variant="outline" size="sm" className="gap-1" onClick={handleRemix}>
              <GitFork className="h-3 w-3" />
              Remix
            </Button>
          )}
        </div>
      </CardFooter>
    </VibeCard>
  );
}
