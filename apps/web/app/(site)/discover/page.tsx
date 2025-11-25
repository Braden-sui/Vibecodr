"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { useAuth } from "@clerk/clerk-react";
import { ApiFeedResponseSchema } from "@vibecodr/shared";
import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { postsApi, mapApiFeedPostToFeedPost, type FeedPost } from "@/lib/api";
import { featuredTags, normalizeTag } from "@/lib/tags";
import { trackClientError, trackEvent } from "@/lib/analytics";
import { usePageMeta } from "@/lib/seo";
import KineticHeader from "@/src/components/KineticHeader";
import { Compass, Loader2, Sparkles, Tag as TagIcon } from "lucide-react";
import { useReducedMotion } from "@/lib/useReducedMotion";

const DEFAULT_TAG = normalizeTag(featuredTags[0]) || "ai";

export default function DiscoverPage() {
  const { getToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const tokenRef = useRef(getToken);

  const origin =
    typeof window !== "undefined" && window.location && typeof window.location.origin === "string"
      ? window.location.origin
      : "";

  const tagFromUrl = useMemo(() => {
    const param = searchParams.get("tag");
    const normalized = normalizeTag(param ?? "");
    return normalized || DEFAULT_TAG;
  }, [searchParams]);

  const [activeTag, setActiveTag] = useState<string>(tagFromUrl);

  useEffect(() => {
    if (tagFromUrl !== activeTag) {
      setActiveTag(tagFromUrl);
    }
  }, [tagFromUrl, activeTag]);

  useEffect(() => {
    tokenRef.current = getToken;
  }, [getToken]);

  usePageMeta({
    title: "Discover Vibecoders",
    description: "Follow tags to find runnable apps, links, images, and longform vibes from the Vibecodr community.",
    url: origin ? `${origin}/discover` : undefined,
    siteName: "Vibecodr",
    canonicalUrl: origin ? `${origin}/discover` : undefined,
  });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
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

        const response = await postsApi.discover(activeTag, { limit: 20 }, init);
        if (!response.ok) {
          const status = response.status;
          let friendly = "Unable to load discover posts right now.";
          try {
            const body = await response.json();
            if (body && typeof body.error === "string") {
              friendly = body.error;
            }
          } catch (parseError) {
            trackClientError("E-VIBECODR-0511", {
              area: "discover",
              stage: "error_json_parse",
              status,
              message: parseError instanceof Error ? parseError.message : String(parseError),
            });
          }
          if (!cancelled) {
            setPosts([]);
            setError(friendly);
          }
          trackEvent("discover_results_failed", { tag: activeTag, status });
          return;
        }

        const raw = await response.json();
        const parsed = ApiFeedResponseSchema.parse(raw);
        if (cancelled) return;

        const normalizedPosts = parsed.posts.map((post) => mapApiFeedPostToFeedPost(post));
        setPosts(normalizedPosts);
        setError(null);
        trackEvent("discover_results_loaded", { tag: activeTag, count: normalizedPosts.length });
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError" || cancelled) return;
        console.error("Discover load failed:", err);
        setPosts([]);
        setError("Discover is temporarily unavailable. Please try again.");
        trackClientError("E-VIBECODR-0512", {
          area: "discover",
          stage: "network",
          tag: activeTag,
        });
        trackEvent("discover_results_failed", { tag: activeTag, status: "network_error" });
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
  }, [activeTag]);

  const handleTagSelect = (tag: string) => {
    const normalized = normalizeTag(tag);
    if (!normalized) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tag", normalized);
    setSearchParams(nextParams, { replace: true });
    setActiveTag(normalized);
    trackEvent("discover_tag_selected", { tag: normalized });
  };

  const handleCardTagClick = (tag: string) => {
    const normalized = normalizeTag(tag);
    if (!normalized) return;

    handleTagSelect(normalized);
  };

  const renderSkeleton = () => (
    <div className="grid gap-4 md:grid-cols-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="animate-pulse rounded-xl border border-dashed border-muted-foreground/20 p-6">
          <div className="mb-4 h-32 rounded-lg bg-muted" />
          <div className="space-y-3">
            <div className="h-4 w-3/4 rounded bg-muted" />
            <div className="h-3 w-2/3 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <motion.div
      className="space-y-8"
      initial={prefersReducedMotion ? undefined : { opacity: 0, y: 10 }}
      animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <motion.section
        className="vc-glass p-6"
        initial={prefersReducedMotion ? undefined : { opacity: 0, y: 12 }}
        whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Compass className="h-3.5 w-3.5" />
              Discover
            </div>
            <KineticHeader text="Discover Vibecoders" className="text-3xl font-bold tracking-tight" />
            <p className="text-muted-foreground">
              Pick a tag to explore runnable demos powered by that stack.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/post/new" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Share a vibe
            </Link>
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {featuredTags.map((tag) => {
            const normalized = normalizeTag(tag);
            const active = normalized === activeTag;
            return (
              <Button
                key={tag}
                variant={active ? "default" : "secondary"}
                size="sm"
                className="gap-1"
                onClick={() => handleTagSelect(tag)}
              >
                <TagIcon className="h-3.5 w-3.5" />
                #{tag}
              </Button>
            );
          })}
        </div>
      </motion.section>

      {error && (
        <div className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        renderSkeleton()
      ) : posts.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2">
          {posts.map((post) => (
            <FeedCard key={post.id} post={post} onTagClick={handleCardTagClick} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-lg font-semibold">No posts found for #{activeTag} yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Be the first to publish under this tag.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button asChild>
              <Link to="/post/new">Share a vibe</Link>
            </Button>
            <Button variant="outline" onClick={() => handleTagSelect(DEFAULT_TAG)}>
              Reset to #{DEFAULT_TAG}
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
