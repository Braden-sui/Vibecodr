// This file would be imported in the player page to generate metadata
// Note: Next.js 14 App Router doesn't support generateMetadata in client components
// This is a placeholder showing how it would work in a server component

import type { Metadata } from "next";

export async function generatePlayerMetadata(postId: string): Promise<Metadata> {
  // In production, fetch post data from API
  // const post = await fetch(`/api/posts/${postId}`).then(r => r.json());

  // Mock data for now
  const post = {
    title: "Interactive Boids Simulation",
    description: "Watch flocking behavior emerge with adjustable parameters",
    author: { handle: "marta", name: "Marta Chen" },
  };

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://vibecodr.com";
  const url = `${baseUrl}/player/${postId}`;
  const ogImage = `${baseUrl}/api/og-image/${postId}`;

  return {
    title: `${post.title} - Vibecodr`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      siteName: "Vibecodr",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [ogImage],
      creator: `@${post.author.handle}`,
    },
    alternates: {
      canonical: url,
    },
  };
}
