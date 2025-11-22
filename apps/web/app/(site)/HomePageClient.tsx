"use client";

import { useEffect, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { useAuth } from "@clerk/clerk-react";
import { FeedCard } from "@/components/FeedCard";
import { VibesComposer } from "@/components/VibesComposer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Filter, Sparkles, Tag as TagIcon, Play } from "lucide-react";
import { trackClientError, trackEvent } from "@/lib/analytics";
import { postsApi, type FeedPost, mapApiFeedPostToFeedPost } from "@/lib/api";
import { ApiFeedResponseSchema } from "@vibecodr/shared";
import { useReducedMotion } from "@/lib/useReducedMotion";
import KineticHeader from "@/src/components/KineticHeader";

type FeedMode = "latest" | "following" | "foryou";

const availableTags = ["ai", "visualization", "canvas", "cli", "webcontainer", "data"];

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
  const prefersReducedMotion = useReducedMotion();

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
    const nextTags =
      tagsParam && tagsParam.trim()
        ? tagsParam
            .split(",")
            .map((tag: string) => tag.trim())
            .filter(Boolean)
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
        if (typeof getToken === "function") {
          const token = await getToken({ template: "workers" });
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
  }, [mode, searchTerm, selectedTags, getToken]);

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

  const composerSection = (
    <motion.div
      className="relative mx-auto max-w-3xl"
      layout
      initial={prefersReducedMotion ? undefined : { opacity: 0, y: 12 }}
      whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-3xl bg-vc-glow blur-2xl" aria-hidden />
      <VibesComposer onPostCreated={handlePostCreated} className="mb-6" />
    </motion.div>
  );

  const renderPostList = (items: FeedPost[]) => (
    <div className="mx-auto max-w-2xl space-y-5">
      {items.map((post, index) => (
        <motion.div
          key={post.id}
          initial={prefersReducedMotion ? undefined : { opacity: 0, y: 16 }}
          whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ delay: prefersReducedMotion ? 0 : Math.min(0.05 * index, 0.25), duration: 0.35 }}
        >
          <FeedCard post={post} />
        </motion.div>
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

  const toggleTag = (tag: string) => {
    const exists = selectedTags.includes(tag);
    const nextTags = exists ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag];
    trackEvent("feed_tag_toggle", { tag, active: !exists, mode });

    const nextParams = new URLSearchParams(searchParams);
    if (nextTags.length > 0) {
      nextParams.set("tags", nextTags.join(","));
    } else {
      nextParams.delete("tags");
    }
    setSearchParams(nextParams, { replace: true });
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

  return (
    <motion.div
      key={location.key ?? location.pathname}
      className="space-y-10"
      initial={prefersReducedMotion ? undefined : { opacity: 0, y: 8 }}
      animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {(heroPost || isHeroLoading) && (
        <motion.section
          className="relative z-10 overflow-hidden rounded-3xl border bg-vc-hero p-8 shadow-vc-soft"
          initial={prefersReducedMotion ? undefined : { opacity: 0, y: 16 }}
          whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="absolute inset-0 opacity-90" aria-hidden />
          <div className="absolute inset-x-10 top-0 h-40 bg-vc-glow blur-3xl" aria-hidden />
          <div className="relative grid items-center gap-8 lg:grid-cols-[1.3fr_1fr]">
            {heroPost ? (
              <>
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700 shadow-sm backdrop-blur-sm dark:bg-white/10 dark:text-indigo-100">
                    <Sparkles className="h-3.5 w-3.5" />
                    Featured vibe
                  </div>
                  <KineticHeader text={heroPost.title} className="text-3xl font-bold leading-tight tracking-tight md:text-4xl" />
                  <p className="max-w-3xl text-lg text-muted-foreground">
                    {heroPost.description ?? "Run it inline, tweak params, and remix instantly."}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button asChild size="lg">
                      <Link to={heroHref}>Run featured vibe</Link>
                    </Button>
                    <Button asChild variant="outline" size="lg">
                      <Link to="/post/new">Create your own</Link>
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/60 px-3 py-1 backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                      <Play className="h-4 w-4" />
                      <span>{heroPost.stats?.runs ?? 0} runs</span>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/60 px-3 py-1 backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                      <Sparkles className="h-4 w-4 text-amber-500" />
                      <span>Remix-ready</span>
                    </div>
                    {heroTags.length > 0 && (
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/60 px-3 py-1 backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                        <TagIcon className="h-3.5 w-3.5" />
                        <span>{heroTags.map((tag) => `#${tag}`).join(" / ")}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <div className="vc-surface relative overflow-hidden rounded-2xl border shadow-vc-soft-lg">
                    <div className="aspect-video w-full bg-gradient-to-br from-indigo-200/70 via-white to-emerald-100/70 dark:from-indigo-900/50 dark:via-slate-900 dark:to-emerald-900/40" />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(96,165,250,0.25),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(234,179,8,0.2),transparent_40%)]" />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-4 py-3 text-xs font-medium text-muted-foreground backdrop-blur-sm">
                      <span className="truncate">
                        {heroPost.type === "app" ? "Runs inline / sandboxed" : "Report / remixable"}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-700 shadow-sm dark:bg-white/10 dark:text-emerald-100">
                        <Sparkles className="h-3 w-3" />
                        live preview
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700 shadow-sm backdrop-blur-sm dark:bg-white/10 dark:text-indigo-100">
                    <Sparkles className="h-3.5 w-3.5 animate-spin" />
                    Loading featured vibe
                  </div>
                  <div className="h-10 w-3/4 rounded-lg bg-white/70 shadow-sm backdrop-blur-sm dark:bg-white/10" />
                  <div className="space-y-2">
                    <div className="h-5 w-11/12 rounded bg-white/60 backdrop-blur-sm dark:bg-white/10" />
                    <div className="h-5 w-10/12 rounded bg-white/50 backdrop-blur-sm dark:bg-white/10" />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button size="lg" disabled className="pointer-events-none">
                      Loading vibe...
                    </Button>
                    <Button asChild variant="outline" size="lg">
                      <Link to="/post/new">Create your own</Link>
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/60 px-3 py-1 backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                      <Play className="h-4 w-4" />
                      <span>Loading runs...</span>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/60 px-3 py-1 backdrop-blur-sm dark:border-white/10 dark:bg-white/10">
                      <Sparkles className="h-4 w-4 text-amber-500" />
                      <span>Remix-ready</span>
                    </div>
                  </div>
                </div>
                <div className="relative">
                  <div className="vc-surface relative overflow-hidden rounded-2xl border shadow-vc-soft-lg">
                    <div className="aspect-video w-full bg-gradient-to-br from-indigo-200/60 via-white to-emerald-100/60 dark:from-indigo-900/40 dark:via-slate-900 dark:to-emerald-900/30" />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(96,165,250,0.2),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(234,179,8,0.16),transparent_40%)]" />
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.section>
      )}

      <motion.section
        className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-vc-soft dark:bg-slate-900/60"
        initial={prefersReducedMotion ? undefined : { opacity: 0, y: 12 }}
        whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
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
      </motion.section>

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
                    <Button variant="outline">Discover Vibecoders</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="foryou">
          <div className="mb-6 rounded-xl border bg-gradient-to-r from-amber-50 via-white to-amber-50 p-6 dark:from-amber-900/20 dark:via-slate-900 dark:to-amber-800/10">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-amber-100 p-3 dark:bg-amber-900/50">
                <Sparkles className="h-6 w-6 text-amber-600 dark:text-amber-200" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">For You Beta</h3>
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
    </motion.div>
  );
}
