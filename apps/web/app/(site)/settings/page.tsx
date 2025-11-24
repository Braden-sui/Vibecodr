"use client";

import { useEffect, useState } from "react";
import { useUser, useAuth, useClerk } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { Loader2, Save, User, Globe, Github, Twitter, LayoutTemplate } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QuotaUsage } from "@/components/QuotaUsage";
import { profileApi } from "@/lib/api";
import { redirectToSignIn } from "@/lib/client-auth";
import { toast } from "@/lib/toast";
import KineticHeader from "@/src/components/KineticHeader";

export default function SettingsPage() {
  const { user, isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const { openUserProfile } = useClerk();
  
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [githubHandle, setGithubHandle] = useState("");
  const [xHandle, setXHandle] = useState("");

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      redirectToSignIn();
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!user?.username) return;

    let cancelled = false;

    async function loadProfile() {
      try {
        const init = await buildAuthInit();
        const res = await profileApi.get(user!.username!, init);
        
        if (!res.ok) {
          throw new Error("Failed to load profile");
        }

        const data = await res.json();
        if (cancelled) return;

        // Map API response to form state
        setDisplayName(data.user?.name || user?.fullName || "");
        setBio(data.user?.bio || "");
        setWebsiteUrl(data.header?.websiteUrl || "");
        setGithubHandle(data.header?.githubHandle || "");
        setXHandle(data.header?.xHandle || "");
      } catch (error) {
        console.error("Error loading profile:", error);
        toast({
          title: "Error loading profile",
          description: "Could not fetch your profile data. Please try refreshing.",
          variant: "error",
        });
      } finally {
        if (!cancelled) {
          setIsLoadingProfile(false);
        }
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [user]);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const init = await buildAuthInit();
      
      // Construct payload matching UpdateProfilePayload
      const payload = {
        displayName: displayName || null,
        bio: bio || null,
        websiteUrl: websiteUrl || null,
        githubHandle: githubHandle || null,
        xHandle: xHandle || null,
      };

      const res = await profileApi.update(payload, init);

      if (!res.ok) {
        throw new Error("Failed to update profile");
      }

      toast({
        title: "Profile updated",
        description: "Your changes have been saved successfully.",
        variant: "success",
      });
      
      // Attempt to sync basic fields back to Clerk if possible (optional, handled by backend webhook usually)
      if (user && displayName !== user.fullName) {
         // user.update({ firstName: ... }) - split name logic is messy, skipping for safety
      }
      
    } catch (error) {
      console.error("Error updating profile:", error);
      toast({
        title: "Update failed",
        description: "Could not save your changes. Please try again.",
        variant: "error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <KineticHeader text="Settings" className="text-3xl font-bold tracking-tight" />
          <p className="text-muted-foreground">
            Manage your profile, account settings, and plan usage.
          </p>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left Column: Main Settings */}
        <div className="space-y-6 lg:col-span-2">
          <form onSubmit={handleSubmit}>
            <Card>
              <CardHeader>
                <CardTitle>Public Profile</CardTitle>
                <CardDescription>
                  This is how others see you on Vibecodr.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoadingProfile ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="displayName">Display Name</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="displayName"
                          className="pl-9"
                          placeholder="Your Name"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          maxLength={80}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="bio">Bio</Label>
                      <Textarea
                        id="bio"
                        placeholder="Tell us a little bit about yourself"
                        className="min-h-[100px] resize-none"
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        maxLength={500}
                      />
                      <p className="text-xs text-muted-foreground">
                        Markdown is supported. Max 500 characters.
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="websiteUrl">Website</Label>
                        <div className="relative">
                          <Globe className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="websiteUrl"
                            className="pl-9"
                            placeholder="https://example.com"
                            value={websiteUrl}
                            onChange={(e) => setWebsiteUrl(e.target.value)}
                            maxLength={255}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="githubHandle">GitHub</Label>
                        <div className="relative">
                          <Github className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="githubHandle"
                            className="pl-9"
                            placeholder="username"
                            value={githubHandle}
                            onChange={(e) => setGithubHandle(e.target.value)}
                            maxLength={50}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="xHandle">X / Twitter</Label>
                        <div className="relative">
                          <Twitter className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="xHandle"
                            className="pl-9"
                            placeholder="username"
                            value={xHandle}
                            onChange={(e) => setXHandle(e.target.value)}
                            maxLength={50}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
              <CardFooter className="flex justify-between border-t px-6 py-4">
                <div className="text-xs text-muted-foreground">
                  Customize your profile layout in the <Link to="/settings/profile" className="underline hover:text-primary">Profile Editor</Link>.
                </div>
                <Button type="submit" disabled={isLoadingProfile || isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {!isSaving && <Save className="mr-2 h-4 w-4" />}
                  Save Changes
                </Button>
              </CardFooter>
            </Card>
          </form>

          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>
                Manage your authentication methods and account security.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Email Address</p>
                  <p className="text-sm text-muted-foreground">
                    {user.primaryEmailAddress?.emailAddress}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.verification.status === "verified" && (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                      Verified
                    </span>
                  )}
                </div>
              </div>
              
              {user.username && (
                 <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Username</p>
                    <p className="text-sm text-muted-foreground">
                      @{user.username}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t px-6 py-4 bg-muted/50">
               <p className="text-xs text-muted-foreground">
                 To change your email or password, use the <button onClick={() => openUserProfile()} className="underline hover:text-primary font-medium">Clerk User Profile</button> manager.
               </p>
            </CardFooter>
          </Card>
        </div>

        {/* Right Column: Usage & Sidebar */}
        <div className="space-y-6">
          <QuotaUsage />
          
          <Card className="bg-gradient-to-br from-primary/5 to-secondary/10 border-primary/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <LayoutTemplate className="h-5 w-5 text-primary" />
                Profile Builder
              </CardTitle>
              <CardDescription>
                Design a custom layout for your profile with blocks, themes, and pinned vibes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link to="/settings/profile">
                  Open Profile Editor
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
