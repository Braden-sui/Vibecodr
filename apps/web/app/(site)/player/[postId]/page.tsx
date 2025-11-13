import PlayerPageClient from "./PlayerPageClient";

type PlayerPageParams = {
  postId: string;
};

export default async function PlayerPage({
  params,
}: {
  params: Promise<PlayerPageParams>;
}) {
  const resolvedParams = await params;

  return <PlayerPageClient postId={resolvedParams.postId} />;
}
