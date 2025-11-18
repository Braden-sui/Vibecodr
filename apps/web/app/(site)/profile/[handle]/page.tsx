import { redirect } from "next/navigation";

type ProfileParams = {
  handle: string;
};

export default async function LegacyProfileRedirectPage({
  params,
}: {
  params: Promise<ProfileParams>;
}) {
  const { handle } = await params;
  redirect(`/u/${encodeURIComponent(handle)}`);
}
