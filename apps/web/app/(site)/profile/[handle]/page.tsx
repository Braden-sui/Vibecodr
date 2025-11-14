"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FeedCard } from "@/components/FeedCard";
import { UserPlus, UserMinus, Calendar, Sparkles, GitFork, Heart } from "lucide-react";
import { usersApi } from "@/lib/api";

interface UserProfile {
  id: string;
  handle: string;
  name?: string;
  avatarUrl?: string;
  bio?: string;
  plan: string;
  createdAt: number;
  stats: {
    followers: number;
    following: number;
    posts: number;
    runs: number;
    remixes: number;
  };
}

function redirectToSignIn() {
  if (typeof window === "undefined") return;
  const redirectUrl = window.location.pathname + window.location.search;
  window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`);
}

export default function ProfilePage() {
  const params = useParams();
  const handle = params.handle as string;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFollowingLoading, setIsFollowingLoading] = useState(false);

  useEffect(() => {
    fetchProfile();
    fetchPosts();
  }, [handle]);

  const fetchProfile = async () => {
    try {
      const response = await usersApi.getProfile(handle);
      if (!response.ok) throw new Error("Failed to fetch profile");
      const data = await response.json();
      setProfile(data.user);

      // Check if following
      const followResponse = await usersApi.checkFollowing(data.user.id, data.user.id);
      if (followResponse.ok) {
        const followData = await followResponse.json();
        setIsFollowing(followData.following);
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPosts = async () => {
    try {
      const response = await usersApi.getPosts(handle, { limit: 20 });
      if (!response.ok) throw new Error("Failed to fetch posts");
      const data = await response.json();
      setPosts(data.posts || []);
    } catch (error) {
      console.error("Failed to fetch posts:", error);
    }
  };

  const handleFollow = async () => {
    if (!profile || isFollowingLoading) return;

    setIsFollowingLoading(true);
    const wasFollowing = isFollowing;

    // Optimistic update
    setIsFollowing(!isFollowing);
    setProfile({
      ...profile,
      stats: {
        ...profile.stats,
        followers: isFollowing ? profile.stats.followers - 1 : profile.stats.followers + 1,
      },
    });

    try {
      const response = wasFollowing
        ? await usersApi.unfollow(profile.id)
        : await usersApi.follow(profile.id);

      if (response.status === 401) {
        redirectToSignIn();
        throw new Error("Unauthorized");
      }

      if (!response.ok) {
        throw new Error("Failed to follow/unfollow");
      }
    } catch (error) {
      // Revert on error
      setIsFollowing(wasFollowing);
      setProfile({
        ...profile,
        stats: {
          ...profile.stats,
          followers: wasFollowing ? profile.stats.followers + 1 : profile.stats.followers - 1,
        },
      });
      console.error("Failed to follow/unfollow:", error);
    } finally {
      setIsFollowingLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex h-64 flex-col items-center justify-center gap-2">
          <p className="text-xl font-semibold">Profile not found</p>
          <p className="text-muted-foreground">User @{handle} does not exist</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Profile Header */}
      <div className="mb-8 space-y-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          {/* Avatar & Info */}
          <div className="flex gap-4">
            <div className="h-24 w-24 flex-shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-purple-500" />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{profile.name || `@${profile.handle}`}</h1>
                {profile.plan !== "free" && (
                  <span className="rounded-full bg-gradient-to-r from-yellow-500 to-orange-500 px-2 py-0.5 text-xs font-semibold text-white">
                    {profile.plan.toUpperCase()}
                  </span>
                )}
              </div>
              {profile.name && (
                <p className="text-muted-foreground">@{profile.handle}</p>
              )}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  Joined {formatDate(profile.createdAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Follow Button */}
          <Button
            variant={isFollowing ? "outline" : "default"}
            onClick={handleFollow}
            disabled={isFollowingLoading}
            className="gap-2"
          >
            {isFollowing ? (
              <>
                <UserMinus className="h-4 w-4" />
                Unfollow
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Follow
              </>
            )}
          </Button>
        </div>

        {/* Bio */}
        {profile.bio && <p className="text-sm">{profile.bio}</p>}

        {/* Stats */}
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <span className="font-bold">{profile.stats.followers}</span>{" "}
            <span className="text-muted-foreground">Followers</span>
          </div>
          <div>
            <span className="font-bold">{profile.stats.following}</span>{" "}
            <span className="text-muted-foreground">Following</span>
          </div>
          <div>
            <span className="font-bold">{profile.stats.posts}</span>{" "}
            <span className="text-muted-foreground">Posts</span>
          </div>
          <div>
            <span className="font-bold">{profile.stats.runs.toLocaleString()}</span>{" "}
            <span className="text-muted-foreground">Runs</span>
          </div>
          <div>
            <span className="font-bold">{profile.stats.remixes}</span>{" "}
            <span className="text-muted-foreground">Remixes</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="posts" className="w-full">
        <TabsList>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="remixes">Remixes</TabsTrigger>
          <TabsTrigger value="likes">Likes</TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="mt-6">
          {posts.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed">
              <Sparkles className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">No posts yet</p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <FeedCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="remixes" className="mt-6">
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed">
            <GitFork className="h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground">Remixes coming soon</p>
          </div>
        </TabsContent>

        <TabsContent value="likes" className="mt-6">
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed">
            <Heart className="h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground">Liked posts coming soon</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
