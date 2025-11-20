import { notFound } from "next/navigation";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileBlocks } from "@/components/profile/ProfileBlocks";
import { themeToInlineStyle } from "@/lib/profile/theme";

type ProfilePageParams = {
  handle: string;
};

async function fetchProfile(handle: string) {
  const res = await fetch(`/api/profile/${encodeURIComponent(handle)}`, {
    // Cache public profiles for 60s on the edge
    next: { revalidate: 60 },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`E-VIBECODR-2001 failed to load profile: ${res.status}`);
  }

  return (await res.json()) as any;
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<ProfilePageParams>;
}) {
  const { handle } = await params;
  const decodedHandle = decodeURIComponent(handle);
  const profile = await fetchProfile(decodedHandle);

  if (!profile) {
    notFound();
  }

  const style = themeToInlineStyle(profile.theme ?? null);

  return (
    <div style={style} className="min-h-screen bg-[var(--vc-bg)] text-[var(--vc-fg)]">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <ProfileHeader profile={profile} />
        <ProfileBlocks profile={profile} />
      </div>
    </div>
  );
}
