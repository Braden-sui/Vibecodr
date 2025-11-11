"use client";

import { useState } from "react";
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
  Globe,
  Cpu,
  Sliders,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReportButton } from "@/components/ReportButton";

export interface FeedCardProps {
  post: {
    id: string;
    type: "app" | "report";
    title: string;
    description?: string;
    author: {
      id: string;
      handle: string;
      name?: string;
      avatarUrl?: string;
    };
    capsule?: {
      id: string;
      runner: "client-static" | "webcontainer";
      capabilities?: {
        net?: string[];
        storage?: boolean;
        workers?: boolean;
      };
      params?: unknown[];
    };
    coverKey?: string;
    tags?: string[];
    stats: {
      runs: number;
      comments: number;
      likes: number;
      remixes: number;
    };
    createdAt: string;
  };
}

export function FeedCard({ post }: FeedCardProps) {
  const router = useRouter();
  const isApp = post.type === "app";

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
      // TODO: Replace with actual API call using auth token
      const method = wasLiked ? "DELETE" : "POST";
      const response = await fetch(`/api/posts/${post.id}/like`, {
        method,
        headers: {
          Authorization: `Bearer user-id-placeholder`, // TODO: Get from auth
        },
      });

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
    router.push(`/player/${post.id}?tab=comments`);
  };

  const handleRemix = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isApp && post.capsule) {
      router.push(`/studio?remixFrom=${post.capsule.id}`);
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
      } catch (error) {
        // User cancelled or error occurred
      }
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(url);
      // TODO: Show toast notification
    }
  };

  return (
    <Card className="group relative overflow-hidden transition-all hover:shadow-lg">
      {/* Cover/Preview Area */}
      <Link href={`/player/${post.id}`}>
        <div
          className={cn(
            "relative aspect-video w-full overflow-hidden bg-gradient-to-br",
            isApp
              ? "from-blue-500/10 to-purple-500/10"
              : "from-emerald-500/10 to-teal-500/10"
          )}
        >
          {/* Preview canvas or cover image would go here */}
          <div className="flex h-full items-center justify-center">
            {isApp ? (
              <Play className="h-16 w-16 text-muted-foreground/20" />
            ) : (
              <div className="px-8 text-center text-sm text-muted-foreground">
                📝 Report Preview
              </div>
            )}
          </div>

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
        </div>
      </Link>

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-1">
            <Link href={`/player/${post.id}`}>
              <h3 className="line-clamp-2 font-semibold leading-tight hover:text-primary">
                {post.title}
              </h3>
            </Link>
            {post.description && (
              <p className="line-clamp-2 text-sm text-muted-foreground">{post.description}</p>
            )}
          </div>
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

          {isApp && post.capsule?.capabilities?.net && post.capsule.capabilities.net.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <Globe className="h-3 w-3" />
              Network
            </Badge>
          )}

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
