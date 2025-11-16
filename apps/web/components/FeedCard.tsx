"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { redirectToSignIn } from "@/lib/client-auth";
import { toast } from "@/lib/toast";
import { capsulesApi, moderationApi, postsApi } from "@/lib/api";
import { ReportButton } from "@/components/ReportButton";
import { useUser } from "@clerk/nextjs";
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
import { writePreviewHandoff } from "@/lib/handoff";
import { loadRuntimeManifest } from "@/lib/runtime/loadRuntimeManifest";

type PublicMetadata = {
  role?: string;
  isModerator?: boolean;
} | null;

export interface FeedCardProps {
  post: FeedPost;
}

// Global concurrency cap for active previews
let activePreviewCount = 0;
const MAX_ACTIVE_PREVIEWS = 2;

// Global cap for manifest preloads to avoid stampedes
let manifestPreloadsInFlight = 0;
const MAX_MANIFEST_PREFETCH = 3;

export function FeedCard({ post }: FeedCardProps) {
  const router = useRouter();
  const { user, isSignedIn } = useUser();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isModeratorFlag = metadata?.isModerator === true;
  const isModeratorOrAdmin =
    !!user && isSignedIn && (role === "admin" || role === "moderator" || isModeratorFlag);
  const isApp = post.type === "app";
  const [_isHovering, setIsHovering] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState(false);
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

  const handleModerationAction = async (action: "quarantine" | "remove") => {
    if (isModerating) return;

    setIsModerating(true);
    try {
      const response = await moderationApi.moderatePost(post.id, action);

      if (!response.ok) {
        if (response.status === 403) {
          toast({ title: "Forbidden", description: "You don't have moderator access.", variant: "error" });
        } else if (response.status === 503) {
          toast({ title: "Unavailable", description: "Moderation service is temporarily unavailable.", variant: "warning" });
        } else {
          const error = await response.json().catch(() => null);
          toast({ title: "Failed", description: error?.error || "Failed to apply moderation action", variant: "error" });
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

  const capsuleId = post.capsule?.id;
  const isWebContainer = post.capsule?.runner === "webcontainer";
  // Note: WebContainer runner should support equivalent pause/resume semantics when inline runs are enabled.

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
      } catch {
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
          pauseStateRef.current = nextState;

          iframeWindow.postMessage(
            {
              type: nextState === "paused" ? "pause" : "resume",
            },
            "*"
          );
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
  }, [isRunning, capsuleId, post.id]);

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
        pauseStateRef.current = nextState;
        target.postMessage({ type: nextState === "paused" ? "pause" : "resume" }, "*");
      });
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isRunning, capsuleId, post.id]);

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
      window.location.href = `/player/${post.id}`;
      return;
    }

    prebootStartRef.current = Date.now();
    setIsRunning(true);
    if (!previewLoaded) {
      activePreviewCount++;
      clickRunIncrementRef.current = true;
    }
  };

  // Optimistic UI state for like
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.stats.likes);
  const [isLiking, setIsLiking] = useState(false);

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isLiking) return;

    // Optimistic update
    const wasLiked = liked;
    const prevCount = likeCount;
    setLiked(!liked);
    setLikeCount(liked ? likeCount - 1 : likeCount + 1);
    setIsLiking(true);

    try {
      const response = wasLiked ? await postsApi.unlike(post.id) : await postsApi.like(post.id);

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

  const handleComment = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    writePreviewHandoff(post.id, { source: "comments" });
    router.push(`/player/${post.id}?tab=comments`);
  };

  const handleRemix = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isApp && capsuleId) {
      router.push(`/studio?remixFrom=${capsuleId}`);
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const url = `${window.location.origin}/player/${post.id}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: post.title,
          text: post.description,
          url,
        });
      } catch {
        // User cancelled or error occurred
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Share link copied to clipboard.", variant: "success" });
    }
  };

  return (
    <Card ref={cardRef} className="group relative overflow-hidden transition-all hover:shadow-lg">
      {/* Cover/Preview Area */}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="relative"
      >
        <Link href={`/player/${post.id}`} onClick={() => writePreviewHandoff(post.id, { source: "cover" })}>
          <div
            className={cn(
              "relative aspect-video w-full overflow-hidden bg-gradient-to-br",
              isApp
                ? "from-blue-500/10 to-purple-500/10"
                : "from-emerald-500/10 to-teal-500/10"
            )}
          >
            {/* Preview iframe for running apps */}
            {isRunning && capsuleId && (
              <div className="absolute inset-0 z-10">
                <iframe
                  ref={iframeRef}
                  src={capsulesApi.bundleSrc(capsuleId)}
                  className="h-full w-full border-0"
                  sandbox="allow-scripts allow-same-origin"
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
                    setPreviewError(true);
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
                {isApp ? (
                  <>
                    <Button
                      onClick={handleClickToRun}
                      variant="secondary"
                      size="lg"
                      className="gap-2"
                    >
                      <Play className="h-5 w-5" />
                      Run Preview
                    </Button>
                  </>
                ) : (
                  <div className="px-8 text-center text-sm text-muted-foreground">
                    📝 Report Preview
                  </div>
                )}
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

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-1">
            <Link href={`/player/${post.id}`} onClick={() => writePreviewHandoff(post.id, { source: "title" })}>
              <h3 className="line-clamp-2 font-semibold leading-tight hover:text-primary">
                {post.title}
              </h3>
            </Link>
            {post.description && (
              <p className="line-clamp-2 text-sm text-muted-foreground">{post.description}</p>
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
        <Link
          href={`/profile/${post.author.handle}`}
          className="flex items-center gap-2 text-sm hover:underline"
        >
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-500" />
          <span className="font-medium">@{post.author.handle}</span>
        </Link>
      </CardHeader>

      <CardContent className="pb-3">
        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="gap-1">
            {isApp ? <Cpu className="h-3 w-3" /> : <span>📝</span>}
            {isApp ? post.capsule?.runner || "client-static" : "Report"}
          </Badge>

          {isApp && post.capsule?.params && post.capsule.params.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <Sliders className="h-3 w-3" />
              {post.capsule.params.length} params
            </Badge>
          )}

          {post.stats.remixes > 0 && (
            <Badge variant="outline" className="gap-1">
              <GitFork className="h-3 w-3" />
              Remix
            </Badge>
          )}
        </div>

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {post.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs text-muted-foreground">
                #{tag}
              </span>
            ))}
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
    </Card>
  );
}
