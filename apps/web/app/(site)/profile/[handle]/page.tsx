import { redirect } from "next/navigation";

type PageProps = {
  params: { handle: string };
};

export default function LegacyProfileRedirectPage({ params }: PageProps) {
  const handle = params.handle;
  redirect(`/u/${encodeURIComponent(handle)}`);
}
