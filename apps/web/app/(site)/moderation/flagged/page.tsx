"use client";

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useUser, useAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { moderationApi } from "@/lib/api";
import { toast } from "@/lib/toast";
import { trackClientError } from "@/lib/analytics";

type FlaggedItem = {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  createdAt: number;
  author: {
    id: string;
    handle: string;
    name?: string;
    avatarUrl?: string;
  };
};

type PublicMetadata = {
  role?: string;
  isModerator?: boolean;
} | null;

export default function FlaggedPostsPage() {
  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const metadata: PublicMetadata =
    typeof user?.publicMetadata === "object" ? (user.publicMetadata as PublicMetadata) : null;
  const role = metadata?.role;
  const isModeratorFlag = metadata?.isModerator === true;
  const isModeratorOrAdmin =
    !!user && isSignedIn && (role === "admin" || role === "moderator" || isModeratorFlag);

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<FlaggedItem[]>([]);

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
    if (!isModeratorOrAdmin) {
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const init = await buildAuthInit();
        const res = await moderationApi.listFlaggedPosts({ status: "pending", limit: 50 }, init);
        if (res.status === 401) {
          toast({ title: "Sign in required", description: "Please sign in to view moderation", variant: "warning" });
          return;
        }
        if (res.status === 403) {
          toast({ title: "Forbidden", description: "You don't have access to this page.", variant: "error" });
          return;
        }
        if (!res.ok) throw new Error(`Failed to fetch flagged posts (${res.status})`);
        const data = await res.json();
        if (!cancelled) setItems((data.items as FlaggedItem[]) || []);
      } catch (err) {
        if (!cancelled) {
          toast({ title: "Failed to load", description: err instanceof Error ? err.message : "Unknown error", variant: "error" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isModeratorOrAdmin]);

  if (!isModeratorOrAdmin) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Moderation</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Flagged posts</h1>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No flagged posts right now.</p>
      ) : (
        <div className="grid gap-4">
          {items.map((it) => (
            <Card key={it.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link to={`/player/${it.id}`} className="font-medium hover:underline">
                      {it.title || "Untitled"}
                    </Link>
                    <div className="text-xs text-muted-foreground">by @{it.author.handle}</div>
                  </div>
                  <div className="flex gap-2">
                    <Link to={`/player/${it.id}`}>
                      <Button size="sm" variant="outline">Open</Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        try {
                          const init = await buildAuthInit();
                          const res = await moderationApi.moderatePost(it.id, "quarantine", init);
                          if (!res.ok) {
                            let message = "Failed to quarantine";
                            try {
                              const body = (await res.json()) as { error?: unknown };
                              if (body && typeof body.error === "string") {
                                message = body.error;
                              }
                            } catch (error) {
                              const errMessage = error instanceof Error ? error.message : String(error);
                              if (typeof console !== "undefined" && typeof console.error === "function") {
                                console.error("E-VIBECODR-0513 flagged quarantine error JSON parse failed", {
                                  postId: it.id,
                                  status: res.status,
                                  error: errMessage,
                                });
                              }
                              trackClientError("E-VIBECODR-0513", {
                                area: "moderation.flagged.quarantine",
                                postId: it.id,
                                status: res.status,
                                message: errMessage,
                              });
                            }
                            throw new Error(message);
                          }
                          setItems((prev) => prev.filter((x) => x.id !== it.id));
                          toast({ title: "Quarantined", description: "Post has been quarantined.", variant: "success" });
                        } catch (err) {
                          toast({ title: "Action failed", description: err instanceof Error ? err.message : "Unknown error", variant: "error" });
                        }
                      }}
                    >
                      Quarantine
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        const ok = window.confirm("Remove this post? This cannot be undone.");
                        if (!ok) return;
                        try {
                          const init = await buildAuthInit();
                          const res = await moderationApi.moderatePost(it.id, "remove", init);
                          if (!res.ok) throw new Error((await res.json()).error || "Failed to remove");
                          setItems((prev) => prev.filter((x) => x.id !== it.id));
                          toast({ title: "Removed", description: "Post has been removed.", variant: "success" });
                        } catch (err) {
                          toast({ title: "Action failed", description: err instanceof Error ? err.message : "Unknown error", variant: "error" });
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {it.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{it.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
