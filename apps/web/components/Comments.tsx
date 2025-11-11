"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
}

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

  useEffect(() => {
    fetchComments();
  }, [postId]);

  const fetchComments = async () => {
    try {
      const response = await fetch(`/api/posts/${postId}/comments?limit=100`);
      if (!response.ok) throw new Error("Failed to fetch comments");
      const data = await response.json();
      setComments(data.comments || []);
    } catch (error) {
      console.error("Failed to fetch comments:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer user-id-placeholder`, // TODO: Get from auth
        },
        body: JSON.stringify({ body: newComment.trim() }),
      });

      if (!response.ok) throw new Error("Failed to create comment");

      const data = await response.json();
      setComments([...comments, data.comment]);
      setNewComment("");
    } catch (error) {
      console.error("Failed to create comment:", error);
      // TODO: Show error toast
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      const response = await fetch(`/api/comments/${commentId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer user-id-placeholder`, // TODO: Get from auth
        },
      });

      if (!response.ok) throw new Error("Failed to delete comment");

      setComments(comments.filter((c) => c.id !== commentId));
    } catch (error) {
      console.error("Failed to delete comment:", error);
      // TODO: Show error toast
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
                  {currentUserId === comment.user.id && (
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
