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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Sliders } from "lucide-react";
import { postsApi, type FeedPost, mapApiFeedPostToFeedPost } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import type { ManifestParam } from "@vibecodr/shared/manifest";

type PlayerPageClientProps = {
  postId: string;
};

export default function PlayerPageClient({ postId }: PlayerPageClientProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ fps: 0, memory: 0, bootTime: 0 });
  const [capsuleParams, setCapsuleParams] = useState<Record<string, unknown>>({});
  const [areParamsOpen, setAreParamsOpen] = useState(false);
  const [post, setPost] = useState<FeedPost | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeHandleRef = useRef<PlayerIframeHandle | null>(null);
  const { user: _user } = useUser();
  const searchParams = useSearchParams();
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

        const data = await response.json();
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
    if (!postMessageToCapsule("restart")) {
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
    const killed = iframeHandleRef.current?.kill() ?? false;
    if (!killed) {
      postMessageToCapsule("kill");
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
    try {
      const url = `${window.location.origin}/player/${postId}`;
      if (navigator.share) {
        navigator
          .share({
            title: post?.title ?? "Vibecodr vibe",
            text: post?.description,
            url,
          })
          .catch(() => {
            // user cancelled; ignore
          });
      } else {
        navigator.clipboard.writeText(url).catch(() => {
          // ignore clipboard errors
        });
      }
    } catch {
      // no-op
    }
  };

  const handleReport = () => {
    try {
      window.location.assign(`/report/new?postId=${encodeURIComponent(postId)}`);
    } catch {
      // ignore
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
                href={`/profile/${post?.author.handle}`}
                className="text-sm text-muted-foreground hover:underline"
              >
                by @{post?.author.handle}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {post && (
              <>
                <Badge variant="secondary">
                  {post.type === "app" ? post.capsule?.runner || "client-static" : "report"}
                </Badge>
                {post.type === "app" && post.capsule?.capabilities?.net &&
                  post.capsule.capabilities.net.length > 0 && (
                    <Badge variant="outline">Network</Badge>
                  )}
              </>
            )}
          </div>
        </div>
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
                onReady={() => {
                  setIsRunning(true);
                  trackEvent("player_run_started", {
                    postId: post.id,
                    capsuleId: post.capsule?.id,
                    runner: post.capsule?.runner,
                  });
                }}
                onLog={(log) => console.log("Capsule log:", log)}
                onStats={(s) => setStats((prev) => ({ ...prev, ...s }))}
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
            onRestart={handleRestart}
            onKill={handleKill}
            onShare={handleShare}
            onReport={handleReport}
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
