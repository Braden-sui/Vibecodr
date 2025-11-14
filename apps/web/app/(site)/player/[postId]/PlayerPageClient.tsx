"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { PlayerIframe } from "@/components/Player/PlayerIframe";
import { PlayerControls } from "@/components/Player/PlayerControls";
import { PlayerDrawer } from "@/components/Player/PlayerDrawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { postsApi, type FeedPost, mapApiFeedPostToFeedPost } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";

type PlayerPageClientProps = {
  postId: string;
};

export default function PlayerPageClient({ postId }: PlayerPageClientProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ fps: 0, memory: 0, bootTime: 0 });
  const [capsuleParams] = useState<Record<string, unknown>>({});
  const [post, setPost] = useState<FeedPost | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user: _user } = useUser();

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

  const handleRestart = () => {
    // TODO: Send restart message to iframe
    console.log("Restarting capsule...");
  };

  const handleKill = () => {
    setIsRunning(false);
    // TODO: Kill iframe execution
    console.log("Killing capsule...");
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
                capsuleId={post.capsule.id}
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
          />
        </div>
      </div>

      {/* TODO: Implement param controls based on manifest */}
      {/* TODO: Connect to real API */}
      {/* TODO: Implement actual postMessage bridge */}
    </div>
  );
}
