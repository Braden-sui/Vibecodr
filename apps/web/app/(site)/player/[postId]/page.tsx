import PlayerPageClient from "./PlayerPageClient";

type PlayerPageParams = {
  postId: string;
};

export default async function PlayerPage({
  params,
}: {
  params: Promise<PlayerPageParams>;
}) {
  const { postId } = await params;
  return <PlayerPageClient postId={postId} />;
}
