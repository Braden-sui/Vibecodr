import { getBlockDefinition } from "@/lib/profile/blocks";
import type { ProfileBlock } from "@/lib/profile/schema";
import type { ProfilePageData } from "@/lib/profile/blocks";

export type ProfileBlocksProps = {
  profile: {
    user: ProfilePageData["user"] & { createdAt: number | string };
    header: ProfilePageData["header"];
    aboutMd?: string | null;
    blocks: Array<{
      id: string;
      type: ProfileBlock["type"];
      position: number;
      visibility: "public" | "followers" | "private";
      config: ProfileBlock;
    }>;
    projects: ProfilePageData["projects"];
    badges: ProfilePageData["badges"];
    pinnedCapsules?: string[];
  };
};

export function ProfileBlocks({ profile }: ProfileBlocksProps) {
  const data: ProfilePageData = {
    user: {
      handle: profile.user.handle,
      name: profile.user.name,
      avatarUrl: profile.user.avatarUrl,
      plan: profile.user.plan,
    },
    header: profile.header,
    aboutMd: profile.aboutMd ?? null,
    projects: profile.projects,
    badges: profile.badges,
    pinnedCapsules: profile.pinnedCapsules ?? [],
  };

  const blocks = [...profile.blocks].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-6">
      {blocks.map((block) => {
        const def = getBlockDefinition(block.type);
        if (!def) return null;
        const element = def.render({ block: block.config, data });
        if (!element) return null;
        return (
          <section key={block.id} aria-label={def.label} className="space-y-2">
            {element}
          </section>
        );
      })}
    </div>
  );
}
