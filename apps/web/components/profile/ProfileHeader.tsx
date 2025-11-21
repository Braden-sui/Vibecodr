import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { ProfileTheme } from "@/lib/profile/schema";
import KineticHeader from "@/src/components/KineticHeader";

export type ProfileHeaderProps = {
  profile: {
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
    theme?: ProfileTheme | null;
  };
};

function formatJoined(createdAt: number | string): string {
  const timestamp = typeof createdAt === "number" ? createdAt * 1000 : Number(createdAt) * 1000;
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function ProfileHeader({ profile }: ProfileHeaderProps) {
  const { user, header } = profile;

  return (
    <header className="mb-8 space-y-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <Avatar src={user.avatarUrl ?? undefined} alt={user.name || `@${user.handle}`} />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KineticHeader text={user.name || `@${user.handle}`} className="text-2xl font-bold" />
              {user.plan && user.plan !== "free" ? (
                <Badge className="bg-gradient-to-r from-yellow-500 to-orange-500 text-xs font-semibold text-white">
                  {user.plan.toUpperCase()}
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">@{user.handle}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {header.pronouns ? <span>{header.pronouns}</span> : null}
              <span>Joined {formatJoined(user.createdAt)}</span>
              {header.location ? <span>{header.location}</span> : null}
            </div>
          </div>
        </div>
        {/* Links */}
        <div className="flex flex-wrap justify-start gap-2 text-xs sm:justify-end">
          {header.websiteUrl ? (
            <a
              href={header.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
            >
              Website
            </a>
          ) : null}
          {header.githubHandle ? (
            <a
              href={`https://github.com/${header.githubHandle.replace(/^@/, "")}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
            >
              GitHub
            </a>
          ) : null}
          {header.xHandle ? (
            <a
              href={`https://x.com/${header.xHandle.replace(/^@/, "")}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
            >
              X
            </a>
          ) : null}
        </div>
      </div>
      {header.tagline ? <p className="text-sm text-muted-foreground">{header.tagline}</p> : null}
      {user.bio ? <p className="text-sm leading-relaxed">{user.bio}</p> : null}
    </header>
  );
}
