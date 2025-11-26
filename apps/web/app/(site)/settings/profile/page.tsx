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
import { profileApi, capsulesApi } from "@/lib/api";
import type {
  ProfileBlock,
  ProfileTheme,
  UpdateProfilePayload,
} from "@/lib/profile/schema";
import { blockRegistry, getBlockDefinition } from "@/lib/profile/blocks";
import { redirectToSignIn } from "@/lib/client-auth";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { Plan, normalizePlan } from "@vibecodr/shared";

type LayoutBlock = {
  id: string;
  type: ProfileBlock["type"];
  position: number;
  visibility: "public" | "followers" | "private";
  config: ProfileBlock;
};

type NormalizedBlock = UpdateProfilePayload["blocks"] extends Array<infer T> ? T : ProfileBlock;

const makeId = (prefix: string) =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type LoadedProfilePayload = {
  user: {
    id: string;
    handle: string;
    name?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    plan?: Plan | null;
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
  pinnedCapsules: string[];
  profileCapsuleId: string | null;
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

type LinkEntry = { label: string; url: string };

type CapsuleListResponse = {
  capsules?: Array<{ id: unknown; title: unknown }>;
};

function isLoadedProfilePayload(value: unknown): value is LoadedProfilePayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LoadedProfilePayload>;
  const user = candidate.user as { id?: unknown; handle?: unknown } | undefined;
  if (!user || (typeof user.id !== "string" && typeof user.id !== "number") || typeof user.handle !== "string") {
    return false;
  }
  if (!candidate.header || typeof candidate.header !== "object") {
    return false;
  }
  if (!Array.isArray(candidate.blocks) || !Array.isArray(candidate.projects) || !Array.isArray(candidate.badges)) {
    return false;
  }
  if (candidate.pinnedCapsules && !Array.isArray(candidate.pinnedCapsules)) {
    return false;
  }
  return true;
}

function isCapsuleListResponse(value: unknown): value is CapsuleListResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as CapsuleListResponse;
  return Array.isArray(candidate.capsules);
}

function readLinks(raw: unknown): LinkEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (entry && typeof entry === "object") {
      const candidate = entry as { label?: unknown; url?: unknown };
      return {
        label: typeof candidate.label === "string" ? candidate.label : "",
        url: typeof candidate.url === "string" ? candidate.url : "",
      };
    }
    return { label: "", url: "" };
  });
}

function readLinksFromProps(props: Record<string, unknown>): LinkEntry[] {
  return readLinks(props["links"]);
}

function normalizeLinksForPayload(raw: unknown): LinkEntry[] {
  const parsed = readLinks(raw);
  const result: LinkEntry[] = [];
  for (const entry of parsed) {
    const label = entry.label.trim().slice(0, 80);
    const url = entry.url.trim();
    if (!label || !url) continue;
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") continue;
      result.push({ label, url: parsedUrl.toString() });
    } catch {
      continue;
    }
    if (result.length >= 12) break;
  }
  return result;
}

const defaultTheme: ProfileTheme = {
  mode: "system",
  accentHue: 260,
  accentSaturation: 80,
  accentLightness: 60,
  radiusScale: 2,
  density: "comfortable",
  accentColor: null,
  bgColor: "#050816",
  textColor: "#f5f5f5",
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
  coverImageUrl: null,
  glass: true,
  canvasBlur: 8,
};

const DEFAULT_BLOCK_TYPES: ProfileBlock["type"][] = ["banner", "about", "links", "projects", "badges"];

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

function createBlock(type: ProfileBlock["type"], position: number): LayoutBlock {
  const id = makeId(type);
  const baseProps: Record<string, unknown> =
    type === "links"
      ? { links: [{ label: "Website", url: "" }] }
      : type === "markdown"
        ? { content: "" }
        : type === "text"
          ? { content: "" }
          : type === "capsuleEmbed"
            ? { embedUrl: "", height: 360 }
            : {};

  const config: ProfileBlock = {
    id,
    version: 1,
    type,
    visibility: "public",
    position,
    props: baseProps,
  };

  return {
    id,
    type,
    position,
    visibility: "public",
    config,
  };
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.min(100, Math.max(0, s)) / 100;
  const ll = Math.min(100, Math.max(0, l)) / 100;
  const a = ss * Math.min(ll, 1 - ll);
  const convert = (n: number) => {
    const k = (n + hh / 30) % 12;
    const color = ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${convert(0)}${convert(8)}${convert(4)}`;
}

export default function ProfileSettingsPage() {
  const { user, isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [remoteProfile, setRemoteProfile] = useState<LoadedProfilePayload | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bio, setBio] = useState("");
  const [tagline, setTagline] = useState("");
  const [location, setLocation] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [githubHandle, setGithubHandle] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [aboutMd, setAboutMd] = useState("");

  const [theme, setTheme] = useState<ProfileTheme | null>(null);
  const [blocks, setBlocks] = useState<LayoutBlock[]>([]);
  const [newBlockType, setNewBlockType] = useState<ProfileBlock["type"]>("markdown");
  const [pinnedCapsules, setPinnedCapsules] = useState<string[]>([]);
  const [profileCapsuleId, setProfileCapsuleId] = useState("");
  const [capsuleOptions, setCapsuleOptions] = useState<Array<{ id: string; title: string | null }>>([]);
  const [capsulesLoading, setCapsulesLoading] = useState(false);
  const [capsulesError, setCapsulesError] = useState<string | null>(null);

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
        const json: unknown = await res.json();
        if (cancelled) return;

        if (!isLoadedProfilePayload(json)) {
          throw new Error("E-VIBECODR-2202 invalid profile response");
        }

        const rawBlocks: LayoutBlock[] = json.blocks.map((block, index) => {
          const config = (block.config ?? {}) as Partial<ProfileBlock>;
          const position =
            typeof block.position === "number" && Number.isFinite(block.position) ? Number(block.position) : index;
          const visibility: "public" | "followers" | "private" =
            block.visibility === "followers" || block.visibility === "private" ? block.visibility : "public";

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
        });

        const normalizedBlocks =
          rawBlocks.length > 0
            ? [...rawBlocks].sort((a, b) => a.position - b.position)
            : buildInitialBlocks();

        const header = json.header;
        const remoteTheme = json.theme ?? null;

        const loaded: LoadedProfilePayload = {
          user: {
            id: String(json.user.id),
            handle: String(json.user.handle),
            name: json.user.name ?? null,
            avatarUrl: json.user.avatarUrl ?? null,
            bio: json.user.bio ?? null,
            plan: json.user.plan ? normalizePlan(json.user.plan, Plan.FREE) : null,
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
          pinnedCapsules: Array.isArray(json.pinnedCapsules) ? json.pinnedCapsules : [],
          profileCapsuleId: typeof json.profileCapsuleId === "string" ? json.profileCapsuleId : null,
          projects: Array.isArray(json.projects) ? json.projects : [],
          badges: Array.isArray(json.badges) ? json.badges : [],
        };

        setRemoteProfile(loaded);

        setDisplayName(loaded.user.name ?? "");
        setAvatarUrl(loaded.user.avatarUrl ?? "");
        setBio(loaded.user.bio ?? "");
        setTagline(loaded.header.tagline ?? "");
        setLocation(loaded.header.location ?? "");
        setWebsiteUrl(loaded.header.websiteUrl ?? "");
        setXHandle(loaded.header.xHandle ?? "");
        setGithubHandle(loaded.header.githubHandle ?? "");
        setPronouns(loaded.header.pronouns ?? "");
        setAboutMd(loaded.aboutMd ?? "");
        setTheme(remoteTheme ?? defaultTheme);
        setBlocks(normalizedBlocks);
        setPinnedCapsules(loaded.pinnedCapsules ?? []);
        setProfileCapsuleId(loaded.profileCapsuleId ?? "");
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

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    async function loadCapsules() {
      setCapsulesLoading(true);
      setCapsulesError(null);
      try {
        const init = await buildAuthInit();
        const res = await capsulesApi.listMine(init);
        if (!res.ok) {
          throw new Error(`Failed to load capsules (${res.status})`);
        }
        const json: unknown = await res.json();
        if (cancelled) return;
        if (!isCapsuleListResponse(json)) {
          throw new Error("E-VIBECODR-2203 invalid capsule response");
        }
        const options =
          (json.capsules ?? []).map((item) => ({
            id: String(item.id),
            title: typeof item.title === "string" ? item.title : null,
          })) || [];
        setCapsuleOptions(options);
      } catch (err) {
        if (cancelled) return;
        setCapsulesError(err instanceof Error ? err.message : "Failed to load capsules");
      } finally {
        if (!cancelled) {
          setCapsulesLoading(false);
        }
      }
    }
    loadCapsules();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

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

  const handleAddBlock = () => {
    setBlocks((prev) => {
      const next = [...prev, createBlock(newBlockType, prev.length)];
      return next.map((block, index) => ({ ...block, position: index }));
    });
  };

  const handleRemoveBlock = (id: string) => {
    setBlocks((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((block) => block.id !== id).map((block, index) => ({ ...block, position: index }));
      return next.length > 0 ? next : buildInitialBlocks();
    });
  };

  const updateBlockProps = (
    id: string,
    updater: (props: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    setBlocks((prev) =>
      prev.map((block) =>
        block.id === id
          ? {
              ...block,
              config: {
                ...block.config,
                props: updater(block.config.props ?? {}),
              },
            }
          : block,
      ),
    );
  };

  const handleContentChange = (id: string, content: string) => {
    updateBlockProps(id, (props) => ({ ...props, content }));
  };

  const handleAddLink = (id: string) => {
    updateBlockProps(id, (props) => {
      const links = [...readLinksFromProps(props)];
      links.push({ label: "", url: "" });
      return { ...props, links };
    });
  };

  const handleRemoveLink = (id: string, index: number) => {
    updateBlockProps(id, (props) => {
      const links = [...readLinksFromProps(props)];
      links.splice(index, 1);
      return { ...props, links };
    });
  };

  const handleLinkChange = (id: string, index: number, field: "label" | "url", value: string) => {
    updateBlockProps(id, (props) => {
      const links = [...readLinksFromProps(props)];
      const existing = links[index] ?? { label: "", url: "" };
      links[index] = { ...existing, [field]: value };
      return { ...props, links };
    });
  };

  const handleEmbedChange = (id: string, field: "embedUrl" | "height", value: string | number) => {
    updateBlockProps(id, (props) => ({ ...props, [field]: value }));
  };

  const isAllowedEmbedUrl = (value: string) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return host.endsWith("vibecodr.space") || host.endsWith("vibecodr.com");
    } catch {
      return false;
    }
  };

  const handleTogglePinnedCapsule = (capsuleId: string) => {
    setPinnedCapsules((prev) => {
      if (prev.includes(capsuleId)) {
        return prev.filter((id) => id !== capsuleId);
      }
      if (prev.length >= 12) return prev;
      return [...prev, capsuleId];
    });
  };

  const handleAccentHexChange = (value: string) => {
    const normalized = value.trim();
    setTheme((prev) => ({ ...(prev ?? defaultTheme), accentColor: normalized || null }));
  };

  const handleBgHexChange = (value: string) => {
    const normalized = value.trim();
    setTheme((prev) => ({ ...(prev ?? defaultTheme), bgColor: normalized || defaultTheme.bgColor }));
  };

  const handleTextHexChange = (value: string) => {
    const normalized = value.trim();
    setTheme((prev) => ({ ...(prev ?? defaultTheme), textColor: normalized || defaultTheme.textColor }));
  };

  const handleFontChange = (value: string) => {
    const normalized = value.trim();
    setTheme((prev) => ({ ...(prev ?? defaultTheme), fontFamily: normalized || defaultTheme.fontFamily }));
  };

  const handleCoverChange = (value: string) => {
    const normalized = value.trim();
    setTheme((prev) => ({ ...(prev ?? defaultTheme), coverImageUrl: normalized || null }));
  };

  const handleGlassToggle = (value: boolean) => {
    setTheme((prev) => ({ ...(prev ?? defaultTheme), glass: value }));
  };

  const handleCanvasBlurChange = (value: number[]) => {
    const raw = value[0] ?? 0;
    const clamped = Math.min(64, Math.max(0, Math.round(raw)));
    setTheme((prev) => ({ ...(prev ?? defaultTheme), canvasBlur: clamped }));
  };

  const handleSave = async () => {
    if (!isSignedIn) {
      redirectToSignIn("/settings/profile");
      return;
    }

    const trimmedName = displayName.trim();
    const trimmedAvatar = avatarUrl.trim();
    const trimmedBio = bio.trim();
    const trimmedTagline = tagline.trim();
    const trimmedLocation = location.trim();
    const trimmedWebsite = websiteUrl.trim();
    const trimmedX = xHandle.trim();
    const trimmedGithub = githubHandle.trim();
    const trimmedPronouns = pronouns.trim();
    const trimmedAbout = aboutMd.trim();

    const themePayload = theme ?? defaultTheme;
    if (themePayload.coverImageUrl) {
      try {
        new URL(themePayload.coverImageUrl);
      } catch {
        setError("Cover image URL must be a valid absolute URL");
        return;
      }
    }

    let hasInvalidBlocks = false;
    const normalizedBlocks =
      blocks.length > 0
        ? blocks.map<NormalizedBlock | null>((block, index) => {
            const props: Record<string, unknown> = { ...(block.config.props ?? {}) };

            if (block.type === "links") {
              props.links = normalizeLinksForPayload(props.links);
            }

            if (block.type === "markdown" || block.type === "text") {
              props.content = typeof props.content === "string" ? props.content : "";
            }

            if (block.type === "capsuleEmbed") {
              const embedUrl = typeof props.embedUrl === "string" ? props.embedUrl.trim() : "";
              if (embedUrl && !isAllowedEmbedUrl(embedUrl)) {
                setError("Capsule embed URL must be hosted on vibecodr.*");
                hasInvalidBlocks = true;
                return null;
              }
              const heightRaw = Number(props.height ?? 360);
              const height = Number.isFinite(heightRaw) ? Math.min(1200, Math.max(240, Math.round(heightRaw))) : 360;
              props.embedUrl = embedUrl;
              props.height = height;
            }

            return {
              id: block.id,
              version: block.config.version ?? 1,
              type: block.type,
              visibility: block.visibility,
              position: index,
              props,
            };
          })
        : undefined;

    if (hasInvalidBlocks) {
      return;
    }

    const filteredBlocks = normalizedBlocks?.filter((block): block is NormalizedBlock => block !== null);

    const payload: UpdateProfilePayload = {
      displayName: trimmedName || null,
      avatarUrl: trimmedAvatar || null,
      bio: trimmedBio || null,
      tagline: trimmedTagline || null,
      location: trimmedLocation || null,
      websiteUrl: trimmedWebsite || null,
      xHandle: trimmedX || null,
      githubHandle: trimmedGithub || null,
      pronouns: trimmedPronouns || null,
      aboutMd: trimmedAbout || null,
      theme: themePayload,
      blocks: filteredBlocks ?? undefined,
      pinnedCapsules: pinnedCapsules.length ? pinnedCapsules.slice(0, 12) : undefined,
      profileCapsuleId: profileCapsuleId.trim() || null,
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
          const body: unknown = await res.json();
          if (body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string") {
            message = (body as { error: string }).error;
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

    const user = {
      ...remoteProfile.user,
      name: displayName || remoteProfile.user.name,
      avatarUrl: avatarUrl || remoteProfile.user.avatarUrl,
      bio: bio || remoteProfile.user.bio,
    };

    return {
      user,
      header,
      aboutMd: aboutMd || null,
      theme,
      blocks,
      pinnedCapsules,
      profileCapsuleId: profileCapsuleId.trim() || null,
      projects: remoteProfile.projects,
      badges: remoteProfile.badges,
    };
  }, [
    remoteProfile,
    theme,
    displayName,
    avatarUrl,
    bio,
    tagline,
    location,
    websiteUrl,
    xHandle,
    githubHandle,
    pronouns,
    aboutMd,
    pinnedCapsules,
    profileCapsuleId,
    blocks,
  ]);

  const styleVars = previewProfile ? themeToInlineStyle(previewProfile.theme ?? null) : {};
  const style = { ...styleVars, fontFamily: "var(--vc-font)" };
  const accentColorValue =
    theme?.accentColor ??
    hslToHex(
      theme?.accentHue ?? defaultTheme.accentHue,
      theme?.accentSaturation ?? defaultTheme.accentSaturation,
      theme?.accentLightness ?? defaultTheme.accentLightness
    );
  const backgroundColorValue = theme?.bgColor ?? defaultTheme.bgColor ?? "#050816";
  const textColorValue = theme?.textColor ?? defaultTheme.textColor ?? "#f5f5f5";
  const fontFamilyValue =
    theme?.fontFamily ?? defaultTheme.fontFamily ?? "Inter, system-ui, -apple-system, sans-serif";

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
                <label htmlFor="displayName" className="text-sm font-medium">
                  Display name
                </label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="How you want to appear on your profile"
                  maxLength={80}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="avatarUrl" className="text-sm font-medium">
                  Avatar URL
                </label>
                <Input
                  id="avatarUrl"
                  type="url"
                  value={avatarUrl}
                  onChange={(event) => setAvatarUrl(event.target.value)}
                  placeholder="https://...your-avatar.png"
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground">Square images look best. We'll keep it inside the canvas.</p>
              </div>

              <div className="space-y-2">
                <label htmlFor="bio" className="text-sm font-medium">
                  Bio
                </label>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="One or two sentences. Appears under your handle."
                  rows={3}
                  maxLength={500}
                />
              </div>

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

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="profileCapsuleId" className="text-sm font-medium">
                    Profile vibe (picker)
                  </label>
                  {capsulesLoading ? <span className="text-xs text-muted-foreground">Loading...</span> : null}
                </div>
                {capsulesError ? (
                  <p className="text-xs text-destructive"> {capsulesError} </p>
                ) : (
                  <select
                    id="profileCapsuleId"
                    value={profileCapsuleId}
                    onChange={(event) => setProfileCapsuleId(event.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="">None</option>
                    {capsuleOptions.map((capsule) => (
                      <option key={capsule.id} value={capsule.id}>
                        {capsule.title || capsule.id}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-muted-foreground">
                  One vibe to embed as your primary profile app (sandboxed). Pick from your published vibes.
                </p>
                <Input
                  value={profileCapsuleId}
                  onChange={(event) => setProfileCapsuleId(event.target.value)}
                  placeholder="vibe_123 (manual override)"
                  maxLength={64}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Pinned vibes</label>
                  <span className="text-xs text-muted-foreground">{pinnedCapsules.length}/12</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {capsuleOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No published vibes yet.</p>
                  ) : (
                    capsuleOptions.map((capsule) => {
                      const checked = pinnedCapsules.includes(capsule.id);
                      return (
                        <button
                          type="button"
                          key={capsule.id}
                          onClick={() => handleTogglePinnedCapsule(capsule.id)}
                          className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                            checked ? "border-primary bg-primary/10" : "border-muted"
                          }`}
                        >
                          <span className="truncate">{capsule.title || capsule.id}</span>
                          <span className="text-xs text-muted-foreground">{checked ? "Pinned" : "Pin"}</span>
                        </button>
                      );
                    })
                  )}
                </div>
                <label htmlFor="pinnedCapsules" className="text-xs font-medium text-muted-foreground">
                  Manual add (comma-separated) if a vibe is not listed
                </label>
                <Input
                  id="pinnedCapsules"
                  value={pinnedCapsules.join(",")}
                  onChange={(event) =>
                    setPinnedCapsules(
                      event.target.value
                        .split(",")
                        .map((id) => id.trim())
                        .filter(Boolean)
                        .slice(0, 12),
                    )
                  }
                  placeholder="vibe_1, vibe_2"
                  maxLength={512}
                />
              </div>

              <Button type="button" onClick={handleSave} disabled={saving || loading} className="mt-2">
                {saving ? "Saving..." : "Save profile"}
              </Button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                <h2 className="mb-2 text-sm font-semibold">Live preview</h2>
                {loading || !previewProfile ? (
                  <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                    Loading preview...
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
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Accent color</span>
                    <span className="text-xs text-muted-foreground">Overrides sliders</span>
                  </div>
                  <input
                    type="color"
                    value={accentColorValue}
                    onChange={(event) => handleAccentHexChange(event.target.value)}
                    className="h-10 w-full cursor-pointer rounded-md border bg-transparent"
                    aria-label="Accent color"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Background</span>
                  </div>
                  <input
                    type="color"
                    value={backgroundColorValue}
                    onChange={(event) => handleBgHexChange(event.target.value)}
                    className="h-10 w-full cursor-pointer rounded-md border bg-transparent"
                    aria-label="Background color"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Text</span>
                  </div>
                  <input
                    type="color"
                    value={textColorValue}
                    onChange={(event) => handleTextHexChange(event.target.value)}
                    className="h-10 w-full cursor-pointer rounded-md border bg-transparent"
                    aria-label="Text color"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="coverImage" className="text-sm font-medium">
                    Cover image URL
                  </label>
                  <Input
                    id="coverImage"
                    type="url"
                    value={theme?.coverImageUrl ?? ""}
                    onChange={(event) => handleCoverChange(event.target.value)}
                    placeholder="https://assets.vibecodr.space/..."
                    maxLength={500}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional background image for the profile canvas.
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="fontFamily" className="text-sm font-medium">
                    Font
                  </label>
                  <select
                    id="fontFamily"
                    value={fontFamilyValue}
                    onChange={(event) => handleFontChange(event.target.value)}
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="Inter, system-ui, -apple-system, sans-serif">Inter</option>
                    <option value="Space Grotesk, Inter, system-ui, -apple-system, sans-serif">
                      Space Grotesk
                    </option>
                    <option value="JetBrains Mono, ui-monospace, SFMono-Regular, monospace">
                      JetBrains Mono
                    </option>
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Glass + blur</span>
                    <button
                      type="button"
                      onClick={() => handleGlassToggle(!(theme?.glass ?? false))}
                      className={cn(
                        "rounded-md border px-3 py-1 text-xs",
                        theme?.glass ? "border-primary text-primary" : "text-muted-foreground",
                      )}
                      aria-pressed={theme?.glass ?? false}
                    >
                      {theme?.glass ? "Glass on" : "Glass off"}
                    </button>
                  </div>
                  <Slider
                    min={0}
                    max={64}
                    step={1}
                    value={[theme?.canvasBlur ?? defaultTheme.canvasBlur ?? 0]}
                    onValueChange={handleCanvasBlurChange}
                  />
                  <p className="text-xs text-muted-foreground">
                    Controls blur intensity behind cards when glass is enabled.
                  </p>
                </div>
              </div>

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
                {saving ? "Saving..." : "Save theme"}
              </Button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                <h2 className="mb-2 text-sm font-semibold">Theme preview</h2>
                {loading || !previewProfile ? (
                  <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                    Loading preview...
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
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={newBlockType}
                  onChange={(event) => setNewBlockType(event.target.value as ProfileBlock["type"])}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  {blockRegistry
                    .filter((b) => b.type !== "header")
                    .map((b) => (
                      <option key={b.type} value={b.type}>
                        {b.label}
                      </option>
                    ))}
                </select>
                <Button type="button" onClick={handleAddBlock} variant="secondary" size="sm">
                  + Add block
                </Button>
              </div>
              <div className="space-y-2">
                {blocks.map((block: LayoutBlock, index: number) => {
                  const def = getBlockDefinition(block.type) ??
                    blockRegistry.find((b) => b.type === block.type);
                  const label = def?.label ?? block.type;
                  const currentLinks = readLinksFromProps(block.config.props ?? {});
                  return (
                    <div
                      key={block.id}
                      className="space-y-3 rounded-md border bg-background px-3 py-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
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
                          <div className="flex items-center gap-1">
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
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => handleRemoveBlock(block.id)}
                            aria-label="Remove block"
                          >
                            x
                          </Button>
                        </div>
                      </div>
                      {block.type === "markdown" || block.type === "text" ? (
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">
                            {block.type === "markdown" ? "Markdown content" : "Text content"}
                          </label>
                          <Textarea
                            value={typeof block.config.props?.content === "string" ? block.config.props.content : ""}
                            onChange={(event) => handleContentChange(block.id, event.target.value)}
                            rows={4}
                            placeholder="Write content for this block"
                          />
                        </div>
                      ) : null}
                      {block.type === "links" ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">Links</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => handleAddLink(block.id)}
                              className="h-7 px-2 text-xs"
                            >
                              + Add link
                            </Button>
                          </div>
                          {currentLinks.length > 0 ? (
                            currentLinks.map((link, linkIndex: number) => (
                              <div key={`${block.id}-link-${linkIndex}`} className="grid gap-2 sm:grid-cols-[2fr_3fr_auto]">
                                <Input
                                  value={link?.label ?? ""}
                                  onChange={(event) =>
                                    handleLinkChange(block.id, linkIndex, "label", event.target.value)
                                  }
                                  placeholder="Label"
                                  className="h-9"
                                  maxLength={80}
                                />
                                <Input
                                  value={link?.url ?? ""}
                                  onChange={(event) =>
                                    handleLinkChange(block.id, linkIndex, "url", event.target.value)
                                  }
                                  placeholder="https://"
                                  className="h-9"
                                  maxLength={500}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 text-destructive"
                                  onClick={() => handleRemoveLink(block.id, linkIndex)}
                                  aria-label="Remove link"
                                >
                                  x
                                </Button>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">No links yet.</p>
                          )}
                        </div>
                      ) : null}
                      {block.type === "capsuleEmbed" ? (
                        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Embed URL (vibecodr.* only)</label>
                            <Input
                              value={typeof block.config.props?.embedUrl === "string" ? block.config.props.embedUrl : ""}
                              onChange={(event) => handleEmbedChange(block.id, "embedUrl", event.target.value)}
                              placeholder="https://assets.vibecodr.space/runner.html?..."
                              maxLength={500}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Height (px)</label>
                            <Input
                              type="number"
                              value={Number(block.config.props?.height ?? 360)}
                              onChange={(event) =>
                                handleEmbedChange(block.id, "height", Number(event.target.value))
                              }
                              min={240}
                              max={1200}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <Button type="button" onClick={handleSave} disabled={saving || loading} className="mt-2">
                {saving ? "Saving..." : "Save layout"}
              </Button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-4 text-sm">
                <h2 className="mb-2 text-sm font-semibold">Layout preview</h2>
                {loading || !previewProfile ? (
                  <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                    Loading preview...
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
