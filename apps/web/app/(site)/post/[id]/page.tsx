// Route: /post/[id] — Post detail
// Responsibilities
// - App post: inline player header + notes/comments
// - Report post: rich text + inline snapshots
// TODOs
// - Fetch post payload; render based on type

type PostDetailParams = {
  id: string;
};

export default async function PostDetail({
  params,
}: {
  params: Promise<PostDetailParams>;
}) {
  const { id } = await params;
  return (
    <section>
      <h1>Post {id}</h1>
      <p>TODO: detect post type and render appropriately.</p>
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
        <em>Inline player or report content goes here.</em>
      </div>
    </section>
  );
}
