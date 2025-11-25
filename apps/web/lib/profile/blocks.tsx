import * as React from "react";
import type { ProfileBlock } from "./schema";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import VibeCard from "@/src/components/VibeCard";
import { Plan, normalizePlan } from "@vibecodr/shared";

export type ProfilePageData = {
  user: {
    handle: string;
    name?: string | null;
    avatarUrl?: string | null;
    plan?: Plan | null;
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
  pinnedCapsules?: string[];
};

export type BlockRendererProps = {
  block: ProfileBlock;
  data: ProfilePageData;
};

export type BlockRenderer = (props: BlockRendererProps) => React.ReactElement | null;

export type BlockDefinition = {
  type: ProfileBlock["type"];
  label: string;
  description: string;
  render: BlockRenderer;
};

const MAX_LINKS = 12;

const asString = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
};

const normalizeUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
};

const allowedEmbedUrl = (value: unknown): string | null => {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();
    if (host.endsWith("vibecodr.space") || host.endsWith("vibecodr.com")) {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
};

const buildLinkItems = (block: ProfileBlock, data: ProfilePageData) => {
  const items: Array<{ label: string; url: string }> = [];

  const website = normalizeUrl(data.header.websiteUrl);
  if (website) items.push({ label: "Website", url: website });
  const github = asString(data.header.githubHandle, 80);
  if (github) {
    items.push({ label: "GitHub", url: `https://github.com/${github.replace(/^@/, "")}` });
  }
  const xHandle = asString(data.header.xHandle, 80);
  if (xHandle) {
    items.push({ label: "X", url: `https://x.com/${xHandle.replace(/^@/, "")}` });
  }

  const rawLinks = Array.isArray(block.props?.links) ? block.props.links : [];
  for (const raw of rawLinks) {
    if (!raw || typeof raw !== "object") continue;
    const link = raw as { label?: unknown; url?: unknown };
    const label = asString(link.label, 80);
    const url = normalizeUrl(link.url);
    if (!label || !url) continue;
    items.push({ label, url });
    if (items.length >= MAX_LINKS) break;
  }

  const unique = new Map<string, { label: string; url: string }>();
  for (const link of items) {
    if (!unique.has(link.url)) {
      unique.set(link.url, link);
    }
  }
  return Array.from(unique.values()).slice(0, MAX_LINKS);
};

const renderBanner: BlockRenderer = ({ data }) => {
  const tagline = asString(data.header.tagline, 160);
  const location = asString(data.header.location, 80);
  const pronouns = asString(data.header.pronouns, 40);
  const plan = data.user.plan ? normalizePlan(data.user.plan, Plan.FREE) : null;
  const showPlan = plan !== null && plan !== Plan.FREE;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-[var(--vc-surface)] backdrop-blur-xl p-6 shadow-[var(--shadow,0_20px_60px_rgba(0,0,0,0.45))]">
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage: "var(--vc-cover-image)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(var(--vc-canvas-blur, 0px))",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/70 via-black/50 to-transparent" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <Avatar src={data.user.avatarUrl ?? undefined} alt={data.user.name || `@${data.user.handle}`} />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-xl font-semibold">{data.user.name || `@${data.user.handle}`}</div>
              {showPlan ? (
                <Badge className="bg-[var(--vc-accent)] text-xs font-semibold text-black">{plan}</Badge>
              ) : null}
            </div>
            <p className="text-sm text-[var(--vc-muted)]">@{data.user.handle}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--vc-muted)]">
              {pronouns ? <span>{pronouns}</span> : null}
              {location ? <span>{location}</span> : null}
            </div>
          </div>
        </div>
        {tagline ? <p className="max-w-xl text-sm text-[var(--vc-fg)]">{tagline}</p> : null}
      </div>
    </div>
  );
};

const renderAbout: BlockRenderer = ({ data }) => {
  if (!data.aboutMd) return null;
  return (
    <VibeCard className="prose prose-sm max-w-none bg-[color:var(--vc-card)] text-[color:var(--vc-fg)] shadow">
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{data.aboutMd}</div>
    </VibeCard>
  );
};

const renderMarkdown: BlockRenderer = ({ block }) => {
  const content = asString(block.props?.content, 8000);
  if (!content) return null;
  return (
    <VibeCard className="prose prose-sm max-w-none bg-[color:var(--vc-card)] text-[color:var(--vc-fg)] shadow">
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
    </VibeCard>
  );
};

const renderText: BlockRenderer = ({ block }) => {
  const content = asString(block.props?.content, 2000);
  if (!content) return null;
  return (
    <VibeCard className="bg-[color:var(--vc-card)] text-[color:var(--vc-fg)] shadow">
      <p className="text-sm leading-relaxed">{content}</p>
    </VibeCard>
  );
};

const renderProjects: BlockRenderer = ({ data }) => {
  if (!data.projects.length) return null;

  return (
    <section aria-label="Projects" className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--vc-muted)]">Projects</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {data.projects.map((project) => (
          <VibeCard key={project.id} className="flex flex-col gap-2 bg-[color:var(--vc-card)] p-3 shadow">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-[var(--vc-fg)]">{project.title}</h3>
              {project.description ? (
                <p className="text-xs text-[var(--vc-muted)] line-clamp-3">{project.description}</p>
              ) : null}
              {project.tags && project.tags.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {project.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </VibeCard>
        ))}
      </div>
    </section>
  );
};

const renderCapsuleGrid: BlockRenderer = ({ data }) => {
  const pins = Array.isArray(data.pinnedCapsules) ? data.pinnedCapsules : [];
  if (!pins.length) {
    return (
      <VibeCard className="bg-[color:var(--vc-card)] p-4 text-[color:var(--vc-fg)] shadow">
        <p className="text-sm text-[var(--vc-muted)]">No pinned capsules yet.</p>
      </VibeCard>
    );
  }

  return (
    <section aria-label="Capsules" className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--vc-muted)]">Pinned capsules</h2>
      <div className="flex flex-wrap gap-2">
        {pins.map((id) => (
          <Badge key={id} variant="secondary" className="text-xs">
            {id}
          </Badge>
        ))}
      </div>
    </section>
  );
};

const renderBadges: BlockRenderer = ({ data }) => {
  if (!data.badges.length) return null;

  return (
    <section aria-label="Badges" className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--vc-muted)]">Badges</h2>
      <div className="flex flex-wrap gap-2">
        {data.badges.map((badge) => (
          <Badge key={badge.id} variant="secondary">
            {badge.icon ? (
              <span className="mr-1" aria-hidden="true">
                {badge.icon}
              </span>
            ) : null}
            {badge.label}
          </Badge>
        ))}
      </div>
    </section>
  );
};

const renderLinks: BlockRenderer = ({ block, data }) => {
  const links = buildLinkItems(block, data);
  if (!links.length) return null;

  return (
    <VibeCard className="bg-[color:var(--vc-card)] p-4 text-[color:var(--vc-fg)] shadow">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--vc-muted)]">Links</h2>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 px-3 py-1 text-xs transition hover:border-[var(--vc-accent)] hover:text-[var(--vc-accent)]"
          >
            {link.label}
          </a>
        ))}
      </div>
    </VibeCard>
  );
};

const renderCapsuleEmbed: BlockRenderer = ({ block }) => {
  const embedUrl = allowedEmbedUrl(block.props?.embedUrl);
  const heightValue = block.props?.height;
  const height = Number(heightValue ?? 360);
  if (!embedUrl) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-white/20 bg-[color:var(--vc-surface)] backdrop-blur-xl shadow">
      <iframe
        src={embedUrl}
        title="Profile capsule"
        sandbox="allow-scripts"
        // SECURITY: allow-scripts only; allow-same-origin removed per SOTP audit
        className="w-full"
        style={{ height: `${Math.max(240, Math.min(height, 1200))}px`, border: "0" }}
      />
    </div>
  );
};

export const blockRegistry: BlockDefinition[] = [
  {
    type: "header",
    label: "Header",
    description: "Avatar, name, handle, links, and core stats.",
    render: () => null,
  },
  {
    type: "banner",
    label: "Banner",
    description: "Hero section for the profile canvas.",
    render: renderBanner,
  },
  {
    type: "about",
    label: "About",
    description: "Markdown about section.",
    render: renderAbout,
  },
  {
    type: "markdown",
    label: "Markdown",
    description: "Custom markdown block inside the canvas.",
    render: renderMarkdown,
  },
  {
    type: "text",
    label: "Text",
    description: "Simple rich text paragraph.",
    render: renderText,
  },
  {
    type: "links",
    label: "Links",
    description: "Curated outbound links.",
    render: renderLinks,
  },
  {
    type: "projects",
    label: "Projects",
    description: "Cards for projects or collections.",
    render: renderProjects,
  },
  {
    type: "capsuleGrid",
    label: "Capsule grid",
    description: "Pinned capsules/projects in a grid.",
    render: renderCapsuleGrid,
  },
  {
    type: "capsuleEmbed",
    label: "Capsule embed",
    description: "Embed a sandboxed capsule iframe.",
    render: renderCapsuleEmbed,
  },
  {
    type: "badges",
    label: "Badges",
    description: "Earned or curated badges.",
    render: renderBadges,
  },
];

export function getBlockDefinition(type: ProfileBlock["type"]): BlockDefinition | undefined {
  return blockRegistry.find((b) => b.type === type);
}
