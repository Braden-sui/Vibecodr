"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Filter, Search, Sparkles, Tag as TagIcon } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

type FeedMode = "latest" | "following" | "foryou";

const availableTags = ["ai", "visualization", "canvas", "cli", "webcontainer", "live", "data"];

const fallbackPosts = [
    {
      id: "1",
      type: "app" as const,
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
        runner: "client-static" as const,
        capabilities: {
          net: [],
          storage: false,
          workers: false,
        },
        params: [{ name: "count" }, { name: "speed" }],
      },
      tags: ["simulation", "canvas", "animation"],
      stats: {
        runs: 342,
        comments: 12,
        likes: 89,
        remixes: 5,
      },
      createdAt: "2025-11-10T15:30:00Z",
      score: 0.91,
    },
    {
      id: "2",
      type: "report" as const,
      title: "Building a Tiny Paint App",
      description: "A walkthrough of creating a minimal canvas-based drawing tool",
      author: {
        id: "user2",
        handle: "tom",
        name: "Tom Anderson",
        avatarUrl: "/avatars/tom.png",
      },
      tags: ["tutorial", "canvas", "beginner"],
      stats: {
        runs: 0,
        comments: 8,
        likes: 45,
        remixes: 0,
      },
      createdAt: "2025-11-10T12:00:00Z",
      score: 0.78,
    },
    {
      id: "3",
      type: "app" as const,
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
        runner: "client-static" as const,
        capabilities: {
          net: ["api.openweathermap.org"],
          storage: true,
          workers: false,
        },
        params: [{ name: "city" }, { name: "units" }],
      },
      tags: ["weather", "api", "data-viz"],
      stats: {
        runs: 523,
        comments: 24,
        likes: 156,
        remixes: 12,
      },
      createdAt: "2025-11-09T18:45:00Z",
      score: 0.84,
    },
    {
      id: "4",
      type: "app" as const,
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
        runner: "webcontainer" as const,
        capabilities: {
          net: ["cdn.jsdelivr.net"],
          storage: true,
          workers: false,
        },
        params: [{ name: "theme" }],
      },
      tags: ["markdown", "editor", "productivity", "live"],
      stats: {
        runs: 789,
        comments: 34,
        likes: 234,
        remixes: 18,
      },
      createdAt: "2025-11-09T10:20:00Z",
      score: 0.88,
    },
];

export default function FeedPage() {
  const [mode, setMode] = useState<FeedMode>("latest");
  const [posts, setPosts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    fetchPosts();
  }, [mode, searchTerm, selectedTags]);

  useEffect(() => {
    if (!searchTerm) return;

    const timer = setTimeout(() => {
      trackEvent("feed_search", { query: searchTerm, mode, tagCount: selectedTags.length });
    }, 500);

    return () => clearTimeout(timer);
  }, [searchTerm, selectedTags.length, mode]);

  const fetchPosts = async () => {
    setIsLoading(true);
    try {
      const userId = "user-id-placeholder"; // TODO: hydrate from auth
      const params = new URLSearchParams({
        mode,
        limit: "20",
      });

      if (mode === "following") {
        params.set("userId", userId);
      }

      if (searchTerm.trim()) {
        params.set("q", searchTerm.trim());
      }

      if (selectedTags.length > 0) {
        params.set("tags", selectedTags.join(","));
      }

      const response = await fetch(`/api/posts?${params.toString()}`);
      if (!response.ok) {
        setPosts(fallbackPosts);
        return;
      }

      const data = await response.json();
      setPosts(data.posts || []);
      setLastUpdated(new Date().toISOString());
      trackEvent("feed_results_loaded", {
        mode,
        count: data.posts?.length ?? 0,
        fromNetwork: true,
      });
    } catch (error) {
      console.error("Failed to fetch posts:", error);
      setPosts(fallbackPosts);
      trackEvent("feed_results_loaded", {
        mode,
        count: fallbackPosts.length,
        fromNetwork: false,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredPosts = useMemo(() => {
    const source = posts.length > 0 ? posts : fallbackPosts;
    const query = searchTerm.trim().toLowerCase();

    return source.filter((post) => {
      const matchesTags =
        selectedTags.length === 0 ||
        selectedTags.some((tag) => post.tags?.map((t: string) => t.toLowerCase()).includes(tag));

      const matchesQuery =
        query.length === 0 ||
        post.title.toLowerCase().includes(query) ||
        post.description?.toLowerCase().includes(query) ||
        post.tags?.some((tag: string) => tag.toLowerCase().includes(query));

      return matchesTags && matchesQuery;
    });
  }, [posts, selectedTags, searchTerm]);

  const renderTimeline = () => (
    <div className="relative mx-auto max-w-2xl">
      <div className="space-y-4">
        {filteredPosts.map((post) => (
          <FeedCard key={post.id} post={post} />
        ))}
      </div>
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
      <p className="text-lg font-semibold">No capsules match that query yet.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Try a different tag or{" "}
        <Link href="/studio" className="text-primary underline-offset-4 hover:underline">
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
          Runnable capsules
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Runnable Feed</h1>
          <p className="text-muted-foreground">Click a capsule to run it inline, tweak params, then remix in Studio.</p>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex w-full max-w-xl items-center gap-2 rounded-full border px-3 py-1.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by capsule, author, or capability"
              className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <Link href="/live">
            <Button variant="outline" className="gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              View Live Capsules
            </Button>
          </Link>
        </div>

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

        {mode === "foryou" && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Personalized using runs, remixes, and tags you follow.
            </div>
            <div className="text-xs">
              Updated {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "just now"}
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
          {isLoading ? renderSkeleton() : filteredPosts.length > 0 ? renderTimeline() : emptyState}
        </TabsContent>

        <TabsContent value="following">
          {isLoading ? (
            renderSkeleton()
          ) : filteredPosts.length > 0 ? (
            renderTimeline()
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-12 text-center">
              <p className="text-lg font-semibold">Follow makers to personalize this lane.</p>
              <p className="text-sm text-muted-foreground">
                Once you follow a capsule author their new posts land here automatically.
              </p>
              <Button variant="outline">Discover makers</Button>
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
                  Blends recency, remix velocity, and similar params so you see capsules you’ll actually run.
                </p>
              </div>
            </div>
          </div>
          {isLoading ? renderSkeleton() : filteredPosts.length > 0 ? renderTimeline() : emptyState}
        </TabsContent>
      </Tabs>
    </div>
  );
}
