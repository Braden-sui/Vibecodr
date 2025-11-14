import PlayerPageClient from "./PlayerPageClient";

type PlayerPageParams = {
  postId: string;
};

export default function PlayerPage({
  params,
}: {
  params: PlayerPageParams;
}) {
  return <PlayerPageClient postId={params.postId} />;
}
