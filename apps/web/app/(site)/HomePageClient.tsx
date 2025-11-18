"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FeedCard } from "@/components/FeedCard";
import { VibesComposer } from "@/components/VibesComposer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Filter, Sparkles, Tag as TagIcon } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import {
  postsApi,
  type FeedPost,
  mapApiFeedPostToFeedPost,
} from "@/lib/api";
import { ApiFeedResponseSchema } from "@vibecodr/shared";

type FeedMode = "latest" | "following" | "foryou";

const availableTags = ["ai", "visualization", "canvas", "cli", "webcontainer", "data"];

const fallbackPosts: FeedPost[] = [
  {
    id: "1",
    type: "app",
    title: "Interactive Boids Simulation",
    description: "Watch flocking behavior emerge with adjustable parameters",
    author: {
      id: "user1",
      handle: "marta",
      name: "Marta Chen",
      avatarUrl: "/avatars/marta.png",
    },
    capsule: {
      id: "capsule1",
      runner: "client-static",
      capabilities: {
        net: [],
        storage: false,
        workers: false,
      },
      params: [{ name: "count" }, { name: "speed" }],
      artifactId: null,
    },
    coverKey: null,
    tags: ["simulation", "canvas", "animation"],
    stats: {
      runs: 342,
      comments: 12,
      likes: 89,
      remixes: 5,
    },
    createdAt: "2025-11-10T15:30:00Z",
  },
  {
    id: "2",
    type: "report",
    title: "Building a Tiny Paint App",
    description: "A walkthrough of creating a minimal canvas-based drawing tool",
    author: {
      id: "user2",
      handle: "tom",
      name: "Tom Anderson",
      avatarUrl: "/avatars/tom.png",
    },
    coverKey: null,
    tags: ["tutorial", "canvas", "beginner"],
    stats: {
      runs: 0,
      comments: 8,
      likes: 45,
      remixes: 0,
    },
    createdAt: "2025-11-10T12:00:00Z",
  },
  {
    id: "3",
    type: "app",
    title: "Weather Dashboard",
    description: "Real-time weather data with beautiful visualizations",
    author: {
      id: "user3",
      handle: "sarah_dev",
      name: "Sarah Johnson",
      avatarUrl: "/avatars/sarah.png",
    },
    capsule: {
      id: "capsule3",
      runner: "client-static",
      capabilities: {
        net: ["api.openweathermap.org"],
        storage: true,
        workers: false,
      },
      params: [{ name: "city" }, { name: "units" }],
      artifactId: null,
    },
    coverKey: null,
    tags: ["weather", "api", "data-viz"],
    stats: {
      runs: 523,
      comments: 24,
      likes: 156,
      remixes: 12,
    },
    createdAt: "2025-11-09T18:45:00Z",
  },
  {
    id: "4",
    type: "app",
    title: "Markdown Preview Editor",
    description: "Write and preview markdown in real-time with syntax highlighting",
    author: {
      id: "user4",
      handle: "alex_codes",
      name: "Alex Rivera",
      avatarUrl: "/avatars/alex.png",
    },
    capsule: {
      id: "capsule4",
      runner: "webcontainer",
      capabilities: {
        net: ["cdn.jsdelivr.net"],
        storage: true,
        workers: false,
      },
      params: [{ name: "theme" }],
      artifactId: null,
    },
    coverKey: null,
    tags: ["markdown", "editor", "productivity", "live"],
    stats: {
      runs: 789,
      comments: 34,
      likes: 234,
      remixes: 18,
    },
    createdAt: "2025-11-09T10:20:00Z",
  },
];

export default function FeedPage() {
  const [mode, setMode] = useState<FeedMode>("latest");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  // Keep searchTerm synced with URL `q`
  useEffect(() => {
    setSearchTerm(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setIsLoading(true);
    setFeedError(null);

    const load = async () => {
      try {
        const response = await postsApi.list(
          {
            mode,
            limit: 20,
            q: searchTerm,
            tags: selectedTags,
          },
          { signal: controller.signal }
        );

        if (!response.ok) {
          let payload: any = null;
          try {
            payload = await response.json();
          } catch (error) {
            if (typeof console !== "undefined" && typeof console.error === "function") {
              console.error("E-VIBECODR-0507 feed error JSON parse failed", {
                status: response.status,
                mode,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          if (cancelled) return;
          setPosts([]);
          setLastUpdated(null);
          const friendly =
            mode === "following" && response.status === 400
              ? "Sign in to see the creators you follow."
              : (payload && typeof payload.error === "string"
                  ? payload.error
                  : response.status >= 500
                  ? "Feed temporarily unavailable. Please try again."
                  : "Unable to load feed.");
          setFeedError(friendly);
          trackEvent("feed_results_failed", {
            mode,
            status: response.status,
            tagCount: selectedTags.length,
          });
          return;
        }

        const raw = await response.json();
        const parsed = ApiFeedResponseSchema.parse(raw);
        if (cancelled) return;

        const mapped = parsed.posts.map((p) => mapApiFeedPostToFeedPost(p));
        setPosts(mapped);
        setLastUpdated(new Date().toISOString());
        setFeedError(null);
        trackEvent("feed_results_loaded", {
          mode,
          count: mapped.length,
          fromNetwork: true,
          tagCount: selectedTags.length,
        });
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError" || cancelled) {
          return;
        }
        console.error("Failed to fetch posts:", error);
        if (cancelled) return;
        setPosts([]);
        setFeedError("Feed temporarily unavailable. Please try again.");
        setLastUpdated(null);
        trackEvent("feed_results_failed", { mode, status: "network_error", tagCount: selectedTags.length });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mode, searchTerm, selectedTags]);

  useEffect(() => {
    if (!searchTerm) return;

    const timer = setTimeout(() => {
      trackEvent("feed_search", { query: searchTerm, mode, tagCount: selectedTags.length });
    }, 500);

    return () => clearTimeout(timer);
  }, [searchTerm, selectedTags, mode]);

  const handlePostCreated = (newPost: FeedPost) => {
    // Add new post to the top of the feed optimistically
    setPosts((prev) => [newPost, ...prev]);
    setFeedError(null);
    trackEvent("composer_post_added_to_feed", { postId: newPost.id, type: newPost.type });
  };

  const composerSection = (
    <div className="relative mx-auto max-w-2xl">
      <VibesComposer onPostCreated={handlePostCreated} className="mb-6" />
    </div>
  );

  const renderPostList = (items: FeedPost[]) => (
    <div className="mx-auto max-w-2xl space-y-4">
      {items.map((post) => (
        <FeedCard key={post.id} post={post} />
      ))}
    </div>
  );

  const renderSkeleton = () => (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse rounded-xl border border-dashed border-muted-foreground/20 p-6">
          <div className="mb-4 h-48 rounded-lg bg-muted" />
          <div className="space-y-3">
            <div className="h-4 w-1/2 rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
            <div className="h-3 w-1/3 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );

  const handleModeChange = (value: string) => {
    const nextMode = value as FeedMode;
    setMode(nextMode);
    trackEvent("feed_mode_changed", { mode: nextMode });
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const exists = prev.includes(tag);
      const next = exists ? prev.filter((t) => t !== tag) : [...prev, tag];
      trackEvent("feed_tag_toggle", { tag, active: !exists, mode });
      return next;
    });
  };

  const emptyState = (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <p className="text-lg font-semibold">No vibes match that query yet.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Try a different tag or{" "}
        <Link prefetch={false} href="/studio" className="text-primary underline-offset-4 hover:underline">
          publish one now
        </Link>
        .
      </p>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Runnable vibes
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Runnable Vibes</h1>
          <p className="text-muted-foreground">Click a vibe to run it inline, tweak params, then remix in Studio.</p>
        </div>
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href="/post/new">Share a vibe</Link>
          </Button>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border p-4">
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Filter className="h-4 w-4" />
            Trending tags
          </p>
          <div className="flex flex-wrap gap-2">
            {availableTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition ${
                    active ? "border-primary bg-primary/10 text-primary" : "hover:border-muted-foreground/50"
                  }`}
                >
                  <TagIcon className="h-3 w-3" />
                  #{tag}
                </button>
              );
            })}
          </div>
        </div>

        {feedError && (
          <div className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {feedError}
          </div>
        )}

        {mode === "foryou" && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Personalized using runs, remixes, and tags you follow.
            </div>
            <div className="text-xs">
              {lastUpdated
                ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}`
                : isLoading
                ? "Loading recommendations..."
                : "Waiting for fresh recommendations"}
            </div>
          </div>
        )}
      </div>

      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="latest">Latest</TabsTrigger>
          <TabsTrigger value="following">Following</TabsTrigger>
          <TabsTrigger value="foryou" className="gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            For You
          </TabsTrigger>
        </TabsList>

        <TabsContent value="latest">
          {isLoading ? (
            renderSkeleton()
          ) : (
            <div className="space-y-6">
              {composerSection}
              {posts.length > 0 ? renderPostList(posts) : <div className="mx-auto max-w-2xl">{emptyState}</div>}
            </div>
          )}
        </TabsContent>

        <TabsContent value="following">
          {isLoading ? (
            renderSkeleton()
          ) : (
            <div className="space-y-6">
              {composerSection}
              {posts.length > 0 ? (
                renderPostList(posts)
              ) : (
                <div className="mx-auto max-w-2xl">
                  <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-12 text-center">
                    <p className="text-lg font-semibold">Follow other Vibecoders to personalize this lane.</p>
                    <p className="text-sm text-muted-foreground">
                      Once you follow a creator, their new posts land here automatically.
                    </p>
                    <Button variant="outline">Discover Vibecoders</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="foryou">
          <div className="mb-6 rounded-xl border bg-gradient-to-r from-amber-50 via-white to-amber-50 p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-amber-100 p-3">
                <Sparkles className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">For You Beta</h3>
                <p className="text-sm text-muted-foreground">
                  Blends recency, remix velocity, and similar params so you see vibes you’ll actually run.
                </p>
              </div>
            </div>
          </div>
          {isLoading ? (
            renderSkeleton()
          ) : (
            <div className="space-y-6">
              {composerSection}
              {posts.length > 0 ? renderPostList(posts) : <div className="mx-auto max-w-2xl">{emptyState}</div>}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
