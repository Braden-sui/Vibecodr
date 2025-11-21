import { Routes, Route, useNavigate, useParams, Navigate } from "react-router-dom";
import { Suspense, useEffect, useState } from "react";
import HomePageClient from "@/app/(site)/HomePageClient";
import ShareVibePage from "@/app/(site)/post/new/page";
import PlayerPageClient from "@/app/(site)/player/[postId]/PlayerPageClient";
import PricingPage from "@/app/(site)/pricing/page";
import LivePage from "@/app/(site)/live/page";
import NewReport from "@/app/(site)/report/new/page";
import SettingsPage from "@/app/(site)/settings/page";
import ProfileSettingsPage from "@/app/(site)/settings/profile/page";
import FlaggedPostsPage from "@/app/(site)/moderation/flagged/page";
import ModerationAuditPage from "@/app/(site)/moderation/audit/page";
import ModerationQueue from "@/app/(site)/admin/moderation/page";
import AdminAnalyticsPage from "@/app/(site)/admin/analytics/page";
import { SignIn as ClerkSignIn, SignUp as ClerkSignUp } from "@clerk/clerk-react";
import { Comments } from "@/components/Comments";
import { mapApiFeedPostToFeedPost, type FeedPost, profileApi, postsApi } from "@/lib/api";
import { ApiPostResponseSchema } from "@vibecodr/shared";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileBlocks } from "@/components/profile/ProfileBlocks";
import { themeToInlineStyle } from "@/lib/profile/theme";

function PlayerRouteWrapper() {
  const params = useParams();
  const postId = params.postId ?? "";
  return <PlayerPageClient postId={postId} />;
}

function PostDetailRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | "not_found" | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await postsApi.get(id);
        if (res.status === 404) {
          if (!cancelled) {
            setError("not_found");
          }
          return;
        }
        if (!res.ok) {
          throw new Error(`E-VIBECODR-0501 failed to load post: ${res.status}`);
        }
        const json = await res.json();
        const parsed = ApiPostResponseSchema.parse(json);
        const mapped = mapApiFeedPostToFeedPost(parsed.post);

        if (cancelled) {
          return;
        }

        if (mapped.type === "app") {
          navigate(`/player/${id}`, { replace: true });
          return;
        }

        setPost(mapped);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  if (!id) {
    return <div className="py-10 text-center text-muted-foreground">Missing post id.</div>;
  }

  if (loading) {
    return <div className="py-10 text-center text-muted-foreground">Loading post</div>;
  }

  if (error === "not_found") {
    return <div className="py-10 text-center text-muted-foreground">Post not found.</div>;
  }

  if (!post) {
    return <div className="py-10 text-center text-muted-foreground">Unable to load post.</div>;
  }

  const createdAt = new Date(post.createdAt);
  const createdLabel = createdAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="border-b pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
        <h1 className="mt-1 text-xl font-semibold">{post.title}</h1>
        <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
          <div>
            <span className="font-medium">@{post.author.handle}</span>
          </div>
          <time dateTime={post.createdAt}>{createdLabel}</time>
        </div>
      </header>

      <div className="mt-2 border-t pt-4">
        <Comments postId={post.id} />
      </div>
    </section>
  );
}

function ProfileRouteWrapper() {
  const { handle } = useParams();
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | "not_found" | null>(null);

  useEffect(() => {
    if (!handle) {
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const decodedHandle = decodeURIComponent(handle);
        const res = await profileApi.get(decodedHandle);
        if (res.status === 404) {
          if (!cancelled) {
            setError("not_found");
          }
          return;
        }
        if (!res.ok) {
          throw new Error(`E-VIBECODR-2001 failed to load profile: ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled) {
          setProfile(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (!handle) {
    return <div className="py-10 text-center text-muted-foreground">Missing profile handle.</div>;
  }

  if (loading) {
    return <div className="py-10 text-center text-muted-foreground">Loading profile</div>;
  }

  if (error === "not_found") {
    return <div className="py-10 text-center text-muted-foreground">Profile not found.</div>;
  }

  if (!profile) {
    return <div className="py-10 text-center text-muted-foreground">Unable to load profile.</div>;
  }

  const style = themeToInlineStyle((profile as any).theme ?? null);

  return (
    <div style={style} className="min-h-screen bg-[var(--vc-bg)] text-[var(--vc-fg)]">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <ProfileHeader profile={profile} />
        <ProfileBlocks profile={profile} />
      </div>
    </div>
  );
}

function LegacyProfileRouteWrapper() {
  const { handle } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!handle) {
      return;
    }
    navigate(`/u/${encodeURIComponent(handle)}`, { replace: true });
  }, [handle, navigate]);

  return null;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Loading feed</div>}>
            <HomePageClient />
          </Suspense>
        }
      />

      {/* Posts */}
      <Route path="/post/new" element={<ShareVibePage />} />
      <Route path="/post/:id" element={<PostDetailRoute />} />

      {/* Player */}
      <Route path="/player/:postId" element={<PlayerRouteWrapper />} />

      {/* Marketing / static */}
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/live" element={<LivePage />} />

      {/* Profiles */}
      <Route path="/u/:handle" element={<ProfileRouteWrapper />} />
      <Route path="/profile/:handle" element={<LegacyProfileRouteWrapper />} />

      {/* Reports */}
      <Route path="/report/new" element={<NewReport />} />

      {/* Settings */}
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/settings/profile" element={<ProfileSettingsPage />} />

      {/* Studio - single-page shell handles internal tabs */}
      <Route path="/studio/*" element={<Navigate to="/post/new" replace />} />

      {/* Moderation */}
      <Route path="/moderation/flagged" element={<FlaggedPostsPage />} />
      <Route path="/moderation/audit" element={<ModerationAuditPage />} />
      <Route path="/admin/moderation" element={<ModerationQueue />} />
      <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />

      {/* Auth - wildcard segments */}
      <Route
        path="/sign-in/*"
        element={
          <div className="flex min-h-[60vh] items-center justify-center">
            <ClerkSignIn />
          </div>
        }
      />
      <Route
        path="/sign-up/*"
        element={
          <div className="flex min-h-[60vh] items-center justify-center">
            <ClerkSignUp />
          </div>
        }
      />
    </Routes>
  );
}
