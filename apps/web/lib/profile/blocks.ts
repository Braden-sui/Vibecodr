import * as React from "react";
import type { ProfileBlock } from "./schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import VibeCard from "@/src/components/VibeCard";

export type ProfilePageData = {
  user: {
    handle: string;
    name?: string | null;
    avatarUrl?: string | null;
    plan?: string | null;
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

const renderAbout: BlockRenderer = ({ data }) => {
  if (!data.aboutMd) return null;
  return React.createElement(
    VibeCard,
    {
      className:
        "prose prose-sm max-w-none bg-card text-card-foreground dark:prose-invert",
    },
    React.createElement(
      "div",
      { className: "whitespace-pre-wrap text-sm leading-relaxed" },
      data.aboutMd,
    ),
  );
};

const renderProjects: BlockRenderer = ({ data }) => {
  if (!data.projects.length) return null;

  const projectCards = data.projects.map((project) =>
    React.createElement(
      VibeCard,
      { key: project.id, className: "flex flex-col gap-2 p-3" },
      React.createElement(
        "div",
        { className: "space-y-1" },
        React.createElement(
          "h3",
          { className: "text-sm font-medium" },
          project.title,
        ),
        project.description
          ? React.createElement(
            "p",
            {
              className:
                "text-xs text-muted-foreground line-clamp-3",
            },
            project.description,
          )
          : null,
        project.tags && project.tags.length
          ? React.createElement(
            "div",
            { className: "mt-1 flex flex-wrap gap-1" },
            project.tags.map((tag) =>
              React.createElement(
                Badge,
                {
                  key: tag,
                  variant: "outline",
                  className: "text-[10px]",
                },
                tag,
              ),
            ),
          )
          : null,
      ),
    ),
  );

  return React.createElement(
    "section",
    {
      "aria-label": "Projects",
      className: "space-y-3",
    },
    React.createElement(
      "h2",
      {
        className:
          "text-sm font-semibold uppercase tracking-wide text-muted-foreground",
      },
      "Projects",
    ),
    React.createElement(
      "div",
      { className: "grid gap-4 md:grid-cols-2" },
      projectCards,
    ),
  );
};

const renderBadges: BlockRenderer = ({ data }) => {
  if (!data.badges.length) return null;

  const badgeNodes = data.badges.map((badge) =>
    React.createElement(
      Badge,
      { key: badge.id, variant: "secondary" },
      badge.icon
        ? React.createElement(
          "span",
          {
            className: "mr-1",
            "aria-hidden": "true",
          },
          badge.icon,
        )
        : null,
      badge.label,
    ),
  );

  return React.createElement(
    "section",
    {
      "aria-label": "Badges",
      className: "space-y-2",
    },
    React.createElement(
      "h2",
      {
        className:
          "text-sm font-semibold uppercase tracking-wide text-muted-foreground",
      },
      "Badges",
    ),
    React.createElement(
      "div",
      { className: "flex flex-wrap gap-2" },
      badgeNodes,
    ),
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
    type: "about",
    label: "About",
    description: "Markdown about section.",
    render: renderAbout,
  },
  {
    type: "projects",
    label: "Projects",
    description: "Cards for projects or collections.",
    render: renderProjects,
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
