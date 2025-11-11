// Next.js 14 Dynamic OG Image generation
// This would automatically generate OG images for each post
// Requires @vercel/og package

import { ImageResponse } from "next/og";

// Route segment config
export const runtime = "edge";

// Image metadata
export const alt = "Vibecodr Post";
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

// Image generation
export default async function Image({ params }: { params: { postId: string } }) {
  // TODO: Fetch post data from API
  // const post = await fetch(`${process.env.API_URL}/posts/${params.postId}`).then(r => r.json());

  const post = {
    title: "Interactive Boids Simulation",
    author: { handle: "marta" },
  };

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
            {post.title}
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 32,
              color: "rgba(255, 255, 255, 0.8)",
            }}
          >
            by @{post.author.handle}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
