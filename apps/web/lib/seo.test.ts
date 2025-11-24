import { renderHook } from "@testing-library/react";
import { usePageMeta } from "./seo";

describe("usePageMeta", () => {
  it("sets and restores meta and link tags", () => {
    const originalTitle = "Base Title";
    document.title = originalTitle;

    const meta = {
      title: "Vibe Title | Vibecodr",
      description: "A playable capsule.",
      url: "https://vibecodr.space/player/abc",
      image: "https://vibecodr.space/api/og-image/abc",
      type: "video.other",
      oEmbedUrl: "https://vibecodr.space/api/oembed?url=https://vibecodr.space/player/abc&format=json",
      canonicalUrl: "https://vibecodr.space/player/abc",
    };

    const { unmount } = renderHook(() => usePageMeta(meta));

    expect(document.title).toBe(meta.title);
    expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(meta.title);
    expect(document.head.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary_large_image");
    expect(
      document.head
        .querySelector('link[rel="alternate"][type="application/json+oembed"]')
        ?.getAttribute("href")
    ).toBe(meta.oEmbedUrl);

    unmount();

    expect(document.title).toBe(originalTitle);
    expect(document.head.querySelector('link[rel="alternate"][type="application/json+oembed"]')).toBeNull();
  });
});
