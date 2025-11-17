// Route: /post/[id] — Status post detail
// Responsibilities
// - Render written/status vibes as a simple post detail
// - Show author + timestamp and threaded comments underneath

import { notFound, redirect } from "next/navigation";
import { Comments } from "@/components/Comments";
import { mapApiFeedPostToFeedPost, type FeedPost } from "@/lib/api";
import { ApiPostResponseSchema } from "@vibecodr/shared";

type PostDetailParams = {
  id: string;
};

async function loadPost(id: string): Promise<FeedPost> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://vibecodr.space";

  const res = await fetch(`${baseUrl}/api/posts/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });

  if (res.status === 404) {
    notFound();
  }

  if (!res.ok) {
    throw new Error(`E-VIBECODR-0501 failed to load post: ${res.status}`);
  }

  const json = await res.json();
  const parsed = ApiPostResponseSchema.parse(json);
  return mapApiFeedPostToFeedPost(parsed.post);
}

export default async function PostDetail({
  params,
}: {
  params: Promise<PostDetailParams>;
}) {
  const { id } = await params;
  const post = await loadPost(id);

  // App posts continue to use the Player surface.
  if (post.type === "app") {
    redirect(`/player/${id}`);
  }

  const createdAt = new Date(post.createdAt);
  const createdLabel = createdAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="border-b pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Status
        </p>
        <h1 className="mt-1 text-xl font-semibold">{post.title}</h1>
        <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
          <div>
            <span className="font-medium">@{post.author.handle}</span>
          </div>
          <time dateTime={post.createdAt}>{createdLabel}</time>
        </div>
      </header>

      <div className="mt-2 border-t pt-4">
        <Comments postId={post.id} />
      </div>
    </section>
  );
}

