"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { redirectToSignIn } from "@/lib/client-auth";
import { toast } from "@/lib/toast";
import { commentsApi, moderationApi } from "@/lib/api";
import { useUser } from "@clerk/nextjs";

interface Comment {
  id: string;
  body: string;
  atMs?: number;
  bbox?: string;
  createdAt: number;
  user: {
    id: string;
    handle: string;
    name?: string;
    avatarUrl?: string;
  };
  optimistic?: boolean;
}

type PublicMetadata = {
  role?: string;
  isModerator?: boolean;
} | null;

interface CommentsProps {
  postId: string;
  currentUserId?: string;
  className?: string;
}

export function Comments({ postId, currentUserId, className }: CommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user, isSignedIn } = useUser();
  const viewerId = currentUserId ?? (user?.id ?? undefined);
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isModeratorFlag = metadata?.isModerator === true;
  const isModeratorOrAdmin =
    !!user && isSignedIn && (role === "admin" || role === "moderator" || isModeratorFlag);

  const fetchComments = useCallback(async () => {
    try {
      const response = await commentsApi.fetch(postId, { limit: 100 });
      if (!response.ok) throw new Error("Failed to fetch comments");
      const data = await response.json();
      setComments(data.comments || []);
    } catch (error) {
      console.error("Failed to fetch comments:", error);
      toast({ title: "Failed to load comments", description: error instanceof Error ? error.message : "Unknown error", variant: "error" });
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newComment.trim();
    if (!trimmed || isSubmitting) return;
    if (!isSignedIn) {
      redirectToSignIn();
      return;
    }

    setIsSubmitting(true);
    const optimisticId = `optimistic-${Date.now()}`;
    const emailHandle = user?.primaryEmailAddress?.emailAddress
      ? user.primaryEmailAddress.emailAddress.split("@")[0]
      : undefined;
    const optimisticHandle =
      user?.username || emailHandle || (user?.id ? user.id.slice(0, 8) : undefined) || "you";
    const optimisticComment: Comment = {
      id: optimisticId,
      body: trimmed,
      createdAt: Math.floor(Date.now() / 1000),
      user: {
        id: viewerId ?? "temp-user",
        handle: optimisticHandle,
        name: user?.fullName ?? user?.username ?? undefined,
        avatarUrl: user?.imageUrl ?? undefined,
      },
      optimistic: true,
    };
    setComments((prev) => [...prev, optimisticComment]);
    setNewComment("");

    try {
      const response = await commentsApi.create(postId, trimmed);

      if (response.status === 401) {
        redirectToSignIn();
        throw new Error("Unauthorized");
      }

      if (!response.ok) {
        const msg = (await response.json().catch(() => null))?.error || "Failed to create comment";
        throw new Error(msg);
      }

      const data = await response.json();
      setComments((prev) =>
        prev.map((comment) => (comment.id === optimisticId ? data.comment : comment))
      );
    } catch (error) {
      console.error("Failed to create comment:", error);
      setComments((prev) => prev.filter((comment) => comment.id !== optimisticId));
      setNewComment(trimmed);
      toast({ title: "Failed to comment", description: error instanceof Error ? error.message : "Unknown error", variant: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    const target = comments.find((c) => c.id === commentId);
    if (!target || target.optimistic) return;
    if (!isSignedIn) {
      redirectToSignIn();
      return;
    }

    try {
      const response = isModeratorOrAdmin
        ? await moderationApi.moderateComment(commentId, "remove")
        : await commentsApi.delete(commentId);

      if (response.status === 401) {
        redirectToSignIn();
        throw new Error("Unauthorized");
      }

      if (!response.ok) {
        const msg = (await response.json().catch(() => null))?.error || "Failed to delete comment";
        throw new Error(msg);
      }

      setComments((prev) => prev.filter((c) => c.id !== commentId));
      toast({ title: "Deleted", description: "Comment removed.", variant: "success" });
    } catch (error) {
      console.error("Failed to delete comment:", error);
      toast({ title: "Failed", description: error instanceof Error ? error.message : "Unknown error", variant: "error" });
    }
  };

  const formatRelativeTime = (timestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Comments List */}
      <ScrollArea className="flex-1 px-4">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading comments...</div>
        ) : comments.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No comments yet. Be the first!
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {comments.map((comment) => (
              <div key={comment.id} className="group space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 flex-shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-purple-500" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">@{comment.user.handle}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(comment.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {(((viewerId && viewerId === comment.user.id) || isModeratorOrAdmin) && !comment.optimistic) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => handleDelete(comment.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <p className="pl-10 text-sm">{comment.body}</p>
                {comment.optimistic && (
                  <p className="pl-10 text-xs italic text-muted-foreground">Sending…</p>
                )}
                {comment.atMs !== undefined && (
                  <p className="pl-10 text-xs text-muted-foreground">
                    at {Math.floor(comment.atMs / 1000)}s
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* New Comment Form */}
      <div className="border-t p-4">
        <form onSubmit={handleSubmit} className="space-y-2">
          <Textarea
            placeholder="Add a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            maxLength={2000}
            rows={3}
            className="resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {newComment.length}/2000
            </span>
            <Button type="submit" disabled={!newComment.trim() || isSubmitting} size="sm">
              {isSubmitting ? "Posting..." : "Post"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
