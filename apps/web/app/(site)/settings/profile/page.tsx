"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser, useAuth } from "@clerk/clerk-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileBlocks } from "@/components/profile/ProfileBlocks";
import { themeToInlineStyle } from "@/lib/profile/theme";
import { profileApi } from "@/lib/api";
import type {
  ProfileBlock,
  ProfileTheme,
  UpdateProfilePayload,
} from "@/lib/profile/schema";
import { blockRegistry, getBlockDefinition } from "@/lib/profile/blocks";
import { redirectToSignIn } from "@/lib/client-auth";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

type LayoutBlock = {
  id: string;
  type: ProfileBlock["type"];
  position: number;
  visibility: "public" | "followers" | "private";
  config: ProfileBlock;
};

type LoadedProfilePayload = {
  user: {
    id: string;
    handle: string;
    name?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    plan?: string | null;
    createdAt: number | string;
  };
  header: {
    tagline?: string | null;
    location?: string | null;
    websiteUrl?: string | null;
    xHandle?: string | null;
    githubHandle?: string | null;
    pronouns?: string | null;
  };
  aboutMd?: string | null;
  theme?: ProfileTheme | null;
  blocks: LayoutBlock[];
  projects: Array<{
    id: string;
    title: string;
    description?: string | null;
    coverKey?: string | null;
    tags?: string[] | null;
  }>;
  badges: Array<{
    id: string;
    slug: string;
    label: string;
    description?: string | null;
    icon?: string | null;
    tier?: string | null;
  }>;
};

const defaultTheme: ProfileTheme = {
  mode: "system",
  accentHue: 260,
  accentSaturation: 80,
  accentLightness: 60,
  radiusScale: 2,
  density: "comfortable",
};

const DEFAULT_BLOCK_TYPES: ProfileBlock["type"][] = ["about", "projects", "badges"];

function buildInitialBlocks(): LayoutBlock[] {
  return DEFAULT_BLOCK_TYPES.map((type, index) => {
    const id = `${type}-${index}`;
    const config: ProfileBlock = {
      id,
      version: 1,
      type,
      visibility: "public",
      position: index,
      props: {},
    };
    return {
      id,
      type,
      position: index,
      visibility: "public",
      config,
    };
  });
}

export default function ProfileSettingsPage() {
  const { user, isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [remoteProfile, setRemoteProfile] = useState<LoadedProfilePayload | null>(null);

  const [tagline, setTagline] = useState("");
  const [location, setLocation] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [githubHandle, setGithubHandle] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [aboutMd, setAboutMd] = useState("");

  const [theme, setTheme] = useState<ProfileTheme | null>(null);
  const [blocks, setBlocks] = useState<LayoutBlock[]>([]);

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
    if (!isLoaded) return;
    if (!isSignedIn || !user) {
      setLoading(false);
      return;
    }

    const baseHandle =
      user.username ||
      user.primaryEmailAddress?.emailAddress?.split("@")[0] ||
      user.id.slice(0, 8);

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const init = await buildAuthInit();
        const res = await profileApi.get(baseHandle, init);
        if (res.status === 401) {
          redirectToSignIn("/settings/profile");
          return;
        }
        if (!res.ok) {
          throw new Error(`Failed to load profile (${res.status})`);
        }
        const json = (await res.json()) as any;
        if (cancelled) return;

        const rawBlocks: LayoutBlock[] = Array.isArray(json.blocks)
          ? ((json.blocks as any[]).map((block, index) => {
              const config = (block.config ?? {}) as Partial<ProfileBlock>;
              const position =
                typeof block.position === "number" && Number.isFinite(block.position)
                  ? Number(block.position)
                  : index;
              const visibility: "public" | "followers" | "private" =
                block.visibility === "followers" || block.visibility === "private"
                  ? block.visibility
                  : "public";

              const id: string = String(config.id ?? block.id ?? `${block.type}-${index}`);

              const baseConfig: ProfileBlock = {
                id,
                version: 1,
                type: config.type ?? block.type,
                visibility: config.visibility ?? visibility,
                position,
                props: config.props ?? {},
              };

              return {
                id,
                type: baseConfig.type,
                position,
                visibility: baseConfig.visibility,
                config: baseConfig,
              } satisfies LayoutBlock;
            }) as LayoutBlock[])
          : [];

        const normalizedBlocks =
          rawBlocks.length > 0
            ? [...rawBlocks].sort((a, b) => a.position - b.position)
            : buildInitialBlocks();

        const header = (json.header ?? {}) as LoadedProfilePayload["header"];
        const remoteTheme = (json.theme ?? null) as ProfileTheme | null;

        const loaded: LoadedProfilePayload = {
          user: {
            id: String(json.user.id),
            handle: String(json.user.handle),
            name: json.user.name ?? null,
            avatarUrl: json.user.avatarUrl ?? null,
            bio: json.user.bio ?? null,
            plan: json.user.plan ?? null,
            createdAt: json.user.createdAt,
          },
          header: {
            tagline: header.tagline ?? null,
            location: header.location ?? null,
            websiteUrl: header.websiteUrl ?? null,
            xHandle: header.xHandle ?? null,
            githubHandle: header.githubHandle ?? null,
            pronouns: header.pronouns ?? null,
          },
          aboutMd: json.aboutMd ?? null,
          theme: remoteTheme,
          blocks: normalizedBlocks,
          projects: Array.isArray(json.projects) ? json.projects : [],
          badges: Array.isArray(json.badges) ? json.badges : [],
        };

        setRemoteProfile(loaded);

        setTagline(loaded.header.tagline ?? "");
        setLocation(loaded.header.location ?? "");
        setWebsiteUrl(loaded.header.websiteUrl ?? "");
        setXHandle(loaded.header.xHandle ?? "");
        setGithubHandle(loaded.header.githubHandle ?? "");
        setPronouns(loaded.header.pronouns ?? "");
        setAboutMd(loaded.aboutMd ?? "");
        setTheme(remoteTheme ?? defaultTheme);
        setBlocks(normalizedBlocks);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load profile");
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
  }, [isLoaded, isSignedIn, user]);

  const handleMoveBlock = (index: number, direction: "up" | "down") => {
    setBlocks((prev: LayoutBlock[]) => {
      const next = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next.map((block, i) => ({ ...block, position: i }));
    });
  };

  const handleVisibilityChange = (
    id: string,
    visibility: LayoutBlock["visibility"],
  ) => {
    setBlocks((prev) =>
      prev.map((block) =>
        block.id === id
          ? {
              ...block,
              visibility,
              config: { ...block.config, visibility },
            }
          : block,
      ),
    );
  };

  const handleThemeHueChange = (value: number[]) => {
    setTheme((prev) => ({ ...(prev ?? defaultTheme), accentHue: value[0] ?? 260 }));
  };

  const handleThemeSaturationChange = (value: number[]) => {
    setTheme((prev) => ({ ...(prev ?? defaultTheme), accentSaturation: value[0] ?? 80 }));
  };

  const handleThemeLightnessChange = (value: number[]) => {
    setTheme((prev) => ({ ...(prev ?? defaultTheme), accentLightness: value[0] ?? 60 }));
  };

  const handleRadiusChange = (value: number[]) => {
    const raw = value[0] ?? 2;
    const clamped = Math.min(4, Math.max(1, Math.round(raw)));
    setTheme((prev) => ({ ...(prev ?? defaultTheme), radiusScale: clamped }));
  };

  const handleDensityChange = (value: ProfileTheme["density"]) => {
    setTheme((prev) => ({ ...(prev ?? defaultTheme), density: value }));
  };

  const handleSave = async () => {
    if (!isSignedIn) {
      redirectToSignIn("/settings/profile");
      return;
    }

    const trimmedTagline = tagline.trim();
    const trimmedLocation = location.trim();
    const trimmedWebsite = websiteUrl.trim();
    const trimmedX = xHandle.trim();
    const trimmedGithub = githubHandle.trim();
    const trimmedPronouns = pronouns.trim();
    const trimmedAbout = aboutMd.trim();

    const themePayload = theme ?? defaultTheme;

    const payload: UpdateProfilePayload = {
      tagline: trimmedTagline || null,
      location: trimmedLocation || null,
      websiteUrl: trimmedWebsite || null,
      xHandle: trimmedX || null,
      githubHandle: trimmedGithub || null,
      pronouns: trimmedPronouns || null,
      aboutMd: trimmedAbout || null,
      theme: themePayload,
      blocks:
        blocks.length > 0
          ? blocks.map((block, index) => ({
              id: block.id,
              version: block.config.version ?? 1,
              type: block.type,
              visibility: block.visibility,
              position: index,
              props: block.config.props ?? {},
            }))
          : undefined,
    };

    setSaving(true);
    setError(null);
    try {
      const init = await buildAuthInit();
      const res = await profileApi.update(payload, init);
      if (res.status === 401) {
        redirectToSignIn("/settings/profile");
        return;
      }
      if (!res.ok) {
        let message = "Failed to save profile";
        try {
          const body = (await res.json()) as any;
          if (body && typeof body.error === "string") {
            message = body.error;
          }
        } catch {
          // ignore
        }
        setError(message);
        toast({ title: "Profile not saved", description: message, variant: "error" });
        return;
      }
      toast({ title: "Profile updated", description: "Your profile has been saved.", variant: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save profile";
      setError(message);
      toast({ title: "Profile not saved", description: message, variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const previewProfile = useMemo(() => {
    if (!remoteProfile || !theme) return null;

    const header: LoadedProfilePayload["header"] = {
      tagline: tagline || null,
      location: location || null,
      websiteUrl: websiteUrl || null,
      xHandle: xHandle || null,
      githubHandle: githubHandle || null,
      pronouns: pronouns || null,
    };

    return {
      user: remoteProfile.user,
      header,
      aboutMd: aboutMd || null,
      theme,
      blocks,
      projects: remoteProfile.projects,
      badges: remoteProfile.badges,
    };
  }, [remoteProfile, theme, tagline, location, websiteUrl, xHandle, githubHandle, pronouns, aboutMd, blocks]);

  const style = previewProfile ? themeToInlineStyle(previewProfile.theme ?? null) : {};

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 py-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Update how your public profile looks on vibecodr.space. Changes are saved for your
          handle and apply to your public profile page.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Tabs defaultValue="details" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="theme">Theme</TabsTrigger>
          <TabsTrigger value="layout">Layout</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="tagline" className="text-sm font-medium">
                  Tagline
                </label>
                <Input
                  id="tagline"
                  value={tagline}
                  onChange={(event) => setTagline(event.target.value)}
                  placeholder="What are you exploring right now?"
                  maxLength={160}
                />
                <p className="text-xs text-muted-foreground">Short one-liner shown under your name.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="location" className="text-sm font-medium">
                    Location
                  </label>
                  <Input
                    id="location"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="City, timezone, or remote"
                    maxLength={80}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="pronouns" className="text-sm font-medium">
                    Pronouns
                  </label>
                  <Input
                    id="pronouns"
                    value={pronouns}
                    onChange={(event) => setPronouns(event.target.value)}
                    placeholder="they/them, she/her, he/him"
                    maxLength={40}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label htmlFor="website" className="text-sm font-medium">
                    Website
                  </label>
                  <Input
                    id="website"
                    type="url"
                    value={websiteUrl}
                    onChange={(event) => setWebsiteUrl(event.target.value)}
                    placeholder="https://"
                    maxLength={255}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="github" className="text-sm font-medium">
                    GitHub
                  </label>
                  <Input
                    id="github"
                    value={githubHandle}
                    onChange={(event) => setGithubHandle(event.target.value)}
                    placeholder="@handle"
                    maxLength={50}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="x" className="text-sm font-medium">
                    X
                  </label>
                  <Input
                    id="x"
                    value={xHandle}
                    onChange={(event) => setXHandle(event.target.value)}
                    placeholder="@handle"
                    maxLength={50}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="about" className="text-sm font-medium">
                  About
                </label>
                <Textarea
                  id="about"
                  value={aboutMd}
                  onChange={(event) => setAboutMd(event.target.value)}
                  placeholder="Tell people what you build, explore, and publish. Markdown supported in a future update."
                  rows={6}
                  maxLength={8000}
                />
                <p className="text-xs text-muted-foreground">
                  This appears as the About section on your public profile.
                </p>
              </div>

              <Button type="button" onClick={handleSave} disabled={saving || loading} className="mt-2">
                {saving ? "Saving…" : "Save profile"}
              </Button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                <h2 className="mb-2 text-sm font-semibold">Live preview</h2>
                {loading || !previewProfile ? (
                  <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                    Loading preview…
                  </div>
                ) : (
                  <div
                    style={style}
                    className="rounded-xl bg-[var(--vc-bg)] px-4 py-3 text-[var(--vc-fg)]"
                  >
                    <ProfileHeader profile={previewProfile} />
                    <ProfileBlocks profile={previewProfile} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="theme" className="mt-4">
          <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Accent hue</span>
                  <span className="text-xs text-muted-foreground">
                    {theme?.accentHue ?? defaultTheme.accentHue}
                  </span>
                </div>
                <Slider
                  min={0}
                  max={360}
                  step={1}
                  value={[theme?.accentHue ?? defaultTheme.accentHue]}
                  onValueChange={handleThemeHueChange}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Accent saturation</span>
                  <span className="text-xs text-muted-foreground">
                    {theme?.accentSaturation ?? defaultTheme.accentSaturation}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[theme?.accentSaturation ?? defaultTheme.accentSaturation]}
                  onValueChange={handleThemeSaturationChange}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Accent lightness</span>
                  <span className="text-xs text-muted-foreground">
                    {theme?.accentLightness ?? defaultTheme.accentLightness}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[theme?.accentLightness ?? defaultTheme.accentLightness]}
                  onValueChange={handleThemeLightnessChange}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Corner radius</span>
                  <span className="text-xs text-muted-foreground">
                    {theme?.radiusScale ?? defaultTheme.radiusScale}
                  </span>
                </div>
                <Slider
                  min={1}
                  max={4}
                  step={1}
                  value={[theme?.radiusScale ?? defaultTheme.radiusScale]}
                  onValueChange={handleRadiusChange}
                />
              </div>

              <div className="space-y-3">
                <span className="text-sm font-medium">Density</span>
                <div className="inline-flex gap-2 rounded-full bg-muted p-1 text-xs">
                  {(["comfortable", "cozy", "compact"] as ProfileTheme["density"][]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleDensityChange(value)}
                      className={cn(
                        "rounded-full px-3 py-1",
                        (theme?.density ?? defaultTheme.density) === value
                          ? "bg-background text-foreground shadow"
                          : "text-muted-foreground",
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              <Button type="button" onClick={handleSave} disabled={saving || loading} className="mt-2">
                {saving ? "Saving…" : "Save theme"}
              </Button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                <h2 className="mb-2 text-sm font-semibold">Theme preview</h2>
                {loading || !previewProfile ? (
                  <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                    Loading preview…
                  </div>
                ) : (
                  <div
                    style={style}
                    className="rounded-xl bg-[var(--vc-bg)] px-4 py-3 text-[var(--vc-fg)]"
                  >
                    <ProfileHeader profile={previewProfile} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="layout" className="mt-4">
          <div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Reorder blocks to change how your profile reads. Visibility controls who can see each
                block.
              </p>
              <div className="space-y-2">
                {blocks.map((block: LayoutBlock, index: number) => {
                  const def = getBlockDefinition(block.type) ??
                    blockRegistry.find((b) => b.type === block.type);
                  const label = def?.label ?? block.type;
                  return (
                    <div
                      key={block.id}
                      className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <div className="space-y-1">
                        <div className="font-medium">{label}</div>
                        <div className="text-xs text-muted-foreground">
                          {def?.description ?? "Profile block"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={block.visibility}
                          onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                            handleVisibilityChange(
                              block.id,
                              event.target.value as LayoutBlock["visibility"],
                            )
                          }
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                        >
                          <option value="public">Public</option>
                          <option value="followers">Followers</option>
                          <option value="private">Private</option>
                        </select>
                        <div className="flex flex-col gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={index === 0}
                            onClick={() => handleMoveBlock(index, "up")}
                            aria-label="Move block up"
                          >
                            ^
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            disabled={index === blocks.length - 1}
                            onClick={() => handleMoveBlock(index, "down")}
                            aria-label="Move block down"
                          >
                            v
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <Button type="button" onClick={handleSave} disabled={saving || loading} className="mt-2">
                {saving ? "Saving…" : "Save layout"}
              </Button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                <h2 className="mb-2 text-sm font-semibold">Layout preview</h2>
                {loading || !previewProfile ? (
                  <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                    Loading preview…
                  </div>
                ) : (
                  <div
                    style={style}
                    className="rounded-xl bg-[var(--vc-bg)] px-4 py-3 text-[var(--vc-fg)]"
                  >
                    <ProfileBlocks profile={previewProfile} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
