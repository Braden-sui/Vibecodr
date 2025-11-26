"use client";

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { FeedCard } from "@/components/FeedCard";
import { VibesComposer } from "@/components/VibesComposer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Tag as TagIcon, Play } from "lucide-react";
import { trackClientError, trackEvent } from "@/lib/analytics";
import { postsApi, type FeedPost, mapApiFeedPostToFeedPost } from "@/lib/api";
import { ApiFeedResponseSchema } from "@vibecodr/shared";
import KineticHeader from "@/src/components/KineticHeader";
import { usePageMeta } from "@/lib/seo";
import { featuredTags, normalizeTag, normalizeTagList } from "@/lib/tags";

type FeedMode = "latest" | "following" | "foryou";

const availableTags = featuredTags;

export default function FeedPage() {
  const [mode, setMode] = useState<FeedMode>("latest");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const location = useLocation();
  const { getToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tokenRef = useRef(getToken);
  const origin =
    typeof window !== "undefined" && window.location && typeof window.location.origin === "string"
      ? window.location.origin
      : "";

  usePageMeta({
    title: "Vibecodr | Run, remix, and publish vibes",
    description: "Playable vibe feed. Run inline, tweak params, remix, and share embeds.",
    url: origin || undefined,
    type: "website",
    siteName: "Vibecodr",
    canonicalUrl: origin || undefined,
  });

  useEffect(() => {
    tokenRef.current = getToken;
  }, [getToken]);

  // Keep searchTerm synced with URL `q`
  useEffect(() => {
    const nextSearch = searchParams.get("q") ?? "";
    if (nextSearch !== searchTerm) {
      setSearchTerm(nextSearch);
    }

    const modeParam = searchParams.get("mode");
    const nextMode: FeedMode =
      modeParam === "latest" || modeParam === "following" || modeParam === "foryou"
        ? modeParam
        : "latest";
    if (nextMode !== mode) {
      setMode(nextMode);
    }

    const tagsParam = searchParams.get("tags");
    const nextTags = tagsParam && tagsParam.trim()
      ? normalizeTagList(
        tagsParam
          .split(",")
          .map((tag: string) => tag.trim())
      )
      : [];

    const tagsChanged =
      nextTags.length !== selectedTags.length ||
      nextTags.some((tag, index) => tag !== selectedTags[index]);

    if (tagsChanged) {
      setSelectedTags(nextTags);
    }
  }, [searchParams, mode, searchTerm, selectedTags]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setIsLoading(true);
    setFeedError(null);

    const load = async () => {
      try {
        const t0 = performance.now();
        let init: RequestInit = { signal: controller.signal };
        const tokenProvider = tokenRef.current;
        if (typeof tokenProvider === "function") {
          const token = await tokenProvider({ template: "workers" });
          if (token) {
            init = {
              ...init,
              headers: {
                Authorization: `Bearer ${token}`,
              },
            };
          }
        }

        const response = await postsApi.list(
          {
            mode,
            limit: 20,
            q: searchTerm,
            tags: selectedTags,
          },
          init,
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
            trackClientError("E-VIBECODR-0507", {
              area: "feed",
              stage: "error_json_parse",
              status: response.status,
              mode,
              tagCount: selectedTags.length,
            });
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
          const durationMs = performance.now() - t0;
          trackEvent("feed_results_failed", {
            mode,
            status: response.status,
            tagCount: selectedTags.length,
            durationMs,
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
        const durationMs = performance.now() - t0;
        trackEvent("feed_results_loaded", {
          mode,
          count: mapped.length,
          fromNetwork: true,
          tagCount: selectedTags.length,
          durationMs,
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
        trackClientError("E-VIBECODR-0508", {
          area: "feed",
          stage: "network",
          mode,
          tagCount: selectedTags.length,
        });
        trackEvent("feed_results_failed", {
          mode,
          status: "network_error",
          tagCount: selectedTags.length,
        });
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

  const heroPost = !feedError && posts.length > 0 ? posts[0] : null;
  const heroHref = heroPost
    ? heroPost.type === "app"
      ? `/player/${heroPost.id}`
      : `/post/${heroPost.id}`
    : "/post/new";
  const heroTags = heroPost && Array.isArray(heroPost.tags) ? heroPost.tags.slice(0, 3) : [];
  const isHeroLoading = isLoading && !heroPost;

  // Composer section - no layout animation to prevent flashing on tab switch
  const composerSection = (
    <div className="relative mx-auto max-w-3xl">
      <VibesComposer
        onPostCreated={handlePostCreated}
        className="mb-6 vc-glass"
      />
    </div>
  );

  // Post list - use CSS transitions instead of motion to prevent re-animation on tab switch
  const renderPostList = (items: FeedPost[]) => (
    <div className="mx-auto max-w-2xl space-y-5">
      {items.map((post) => (
        <div
          key={post.id}
          className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <FeedCard post={post} onTagClick={handleFeedTagClick} />
        </div>
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
    const current = (searchParams.get("mode") as FeedMode | null) ?? "latest";
    if (current === nextMode) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    if (nextMode === "latest") {
      nextParams.delete("mode");
    } else {
      nextParams.set("mode", nextMode);
    }
    setSearchParams(nextParams, { replace: true });
    trackEvent("feed_mode_changed", { mode: nextMode });
  };

  const applyTagFilters = (tags: string[], modeOverride?: FeedMode) => {
    const normalized = normalizeTagList(tags);
    const nextMode: FeedMode = modeOverride ?? (mode === "following" ? "foryou" : mode);
    const nextParams = new URLSearchParams(searchParams);

    if (normalized.length > 0) {
      nextParams.set("tags", normalized.join(","));
    } else {
      nextParams.delete("tags");
    }

    if (nextMode === "latest") {
      nextParams.delete("mode");
    } else {
      nextParams.set("mode", nextMode);
    }

    setSearchParams(nextParams, { replace: true });
  };

  const toggleTag = (tag: string) => {
    const normalized = normalizeTag(tag);
    if (!normalized) return;

    const exists = selectedTags.includes(normalized);
    const nextTags = exists ? selectedTags.filter((t) => t !== normalized) : [...selectedTags, normalized];
    const targetMode: FeedMode = mode === "following" ? "latest" : mode;

    trackEvent("feed_tag_toggle", { tag: normalized, active: !exists, mode: targetMode });
    applyTagFilters(nextTags, targetMode);
  };

  const handleFeedTagClick = (tag: string) => {
    const normalized = normalizeTag(tag);
    if (!normalized) return;

    const targetMode: FeedMode = mode === "latest" ? "latest" : "foryou";
    trackEvent("feed_tag_clicked", { tag: normalized, mode: targetMode });
    applyTagFilters([normalized], targetMode);
  };

  const emptyState = (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <p className="text-lg font-semibold">No vibes match that query yet.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Try a different tag or{" "}
        <Link to="/post/new" className="text-primary underline-offset-4 hover:underline">
          publish one now
        </Link>
        .
      </p>
    </div>
  );

  // Remove location.key to prevent full remount on navigation
  // Use stable key to prevent re-animation when switching lanes
  return (
    <div className="space-y-10">
      <section className="vc-glass p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Playable vibes
            </div>
            <KineticHeader text="Run, remix, and publish" className="text-4xl font-bold tracking-tight" />
            <p className="text-lg text-muted-foreground">
              Ship a runnable demo without setup. Test it inline, tweak params, and share the embed in minutes.
            </p>
          </div>
          <Button asChild size="lg" className="self-start lg:self-auto">
            <Link to="/post/new">Start a vibe</Link>
          </Button>
        </div>
      </section>

      {heroPost && (
        <section className="vc-glass p-6 animate-in fade-in duration-300">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Featured vibe</div>
              <h2 className="text-2xl font-semibold leading-tight">{heroPost.title}</h2>
              <p className="text-sm text-muted-foreground">
                {heroPost.description ?? "Open it inline, remix, and publish your own take."}
              </p>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1">
                  <Play className="h-3.5 w-3.5" />
                  {heroPost.stats?.runs ?? 0} runs
                </span>
                {heroTags.length > 0 && (
                  <div className="inline-flex flex-wrap items-center gap-2">
                    <TagIcon className="h-3.5 w-3.5" />
                    {heroTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleFeedTagClick(tag)}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 transition hover:bg-muted/80"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <Button asChild size="sm">
              <Link to={heroHref}>Open featured vibe</Link>
            </Button>
          </div>
        </section>
      )}

      {isHeroLoading && !heroPost && (
        <section className="vc-glass p-6">
          <div className="space-y-3 animate-pulse">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-6 w-2/3 rounded bg-muted" />
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-3/4 rounded bg-muted" />
          </div>
        </section>
      )}

      <section className="vc-glass space-y-4 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Runnable vibes
            </div>
            <div className="space-y-1">
              <KineticHeader text="Run, remix, and publish" className="text-2xl font-bold tracking-tight" />
              <p className="text-muted-foreground">
                Click a vibe to run it inline, tweak params, then remix with the composer.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {availableTags.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition ${active ? "border-primary bg-primary/10 text-primary" : "hover:border-muted-foreground/50"
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
      </section>

      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList className="grid w-full max-w-md grid-cols-3 p-1">
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
            <div className="space-y-8">
              {composerSection}
              {posts.length > 0 ? renderPostList(posts) : <div className="mx-auto max-w-2xl">{emptyState}</div>}
            </div>
          )}
        </TabsContent>

        <TabsContent value="following">
          {isLoading ? (
            renderSkeleton()
          ) : (
            <div className="space-y-8">
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
                    <Button variant="outline" asChild>
                      <Link to="/discover">Discover Vibecoders</Link>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="foryou">
          <div className="vc-glass mb-6 p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-amber-100 p-3 dark:bg-amber-900/50">
                <Sparkles className="h-6 w-6 text-amber-600 dark:text-amber-200" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">For You</h3>
                <p className="text-sm text-muted-foreground">
                  Blends recency, remix velocity, and similar params so you see vibes you'll actually run.
                </p>
              </div>
            </div>
          </div>
          {isLoading ? (
            renderSkeleton()
          ) : (
            <div className="space-y-8">
              {composerSection}
              {posts.length > 0 ? renderPostList(posts) : <div className="mx-auto max-w-2xl">{emptyState}</div>}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
