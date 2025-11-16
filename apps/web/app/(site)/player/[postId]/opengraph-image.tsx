// Next.js 14 Dynamic OG Image generation
// This would automatically generate OG images for each post
// Requires @vercel/og package

import { ImageResponse } from "next/og";
import { getWorkerApiBase } from "@/lib/worker-api";
import { mapApiFeedPostToFeedPost, type FeedPost } from "@/lib/api";
import { ApiPostResponseSchema } from "@vibecodr/shared";

// Route segment config
export const runtime = "edge";

// Image metadata
export const alt = "Vibecodr Post";
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

async function fetchPost(postId: string): Promise<FeedPost | null> {
  const apiBase = getWorkerApiBase();
  try {
    const res = await fetch(`${apiBase}/posts/${encodeURIComponent(postId)}`, {
      headers: {
        Accept: "application/json",
      },
      // OG images can be cached for a bit, but we still want to refresh regularly.
      next: { revalidate: 120 },
    });

    if (!res.ok) {
      return null;
    }

    const payload = ApiPostResponseSchema.parse(await res.json());
    return mapApiFeedPostToFeedPost(payload.post);
  } catch (error) {
    console.error("E-VIBECODR-1101 og:image fetch failed", {
      postId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// Image generation
export default async function Image({ params }: { params: { postId: string } }) {
  const post = await fetchPost(params.postId);
  const title = post?.title ?? "Vibecodr vibe";
  const authorHandle = post?.author.handle ?? "anonymous";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
          padding: "60px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 60,
            fontWeight: 700,
            color: "white",
          }}
        >
          Vibecodr
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 48,
              fontWeight: 600,
              color: "white",
              maxWidth: "90%",
              lineHeight: 1.2,
            }}
          >
            {title}
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 32,
              color: "rgba(255, 255, 255, 0.8)",
            }}
          >
            by @{authorHandle}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
