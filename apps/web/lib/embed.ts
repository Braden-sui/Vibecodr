"use client";

/**
 * Build an iframe embed URL for a post.
 */
export function buildEmbedUrl(origin: string, postId: string): string {
  const normalizedOrigin = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${normalizedOrigin}/e/${encodeURIComponent(postId)}`;
}

/**
 * Build a ready-to-paste iframe snippet for embedding a vibe on external sites.
 */
export function buildEmbedCode(origin: string, postId: string): string {
  const embedUrl = buildEmbedUrl(origin, postId);
  return `<iframe src="${embedUrl}" width="960" height="540" style="border:0;border-radius:12px;overflow:hidden;" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts" allow="accelerometer 'none'; autoplay 'none'; camera 'none'; geolocation 'none'; gyroscope 'none'; microphone 'none'; payment 'none'; usb 'none'" allowfullscreen></iframe>`;
}
