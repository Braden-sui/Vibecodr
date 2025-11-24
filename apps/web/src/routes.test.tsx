import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PostDetailRoute, LegacyProfileRouteWrapper } from "@/src/routes";

const mockNavigate = vi.fn();
let mockParams: Record<string, string | undefined> = {};

const mockPostsGet = vi.fn();
const mockProfileGet = vi.fn();
const mockMapPost = vi.fn();
const mockUsePageMeta = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
  };
});

vi.mock("@/lib/api", () => ({
  postsApi: {
    get: (...args: unknown[]) => mockPostsGet(...args),
  },
  profileApi: {
    get: (...args: unknown[]) => mockProfileGet(...args),
  },
  mapApiFeedPostToFeedPost: (...args: unknown[]) => mockMapPost(...args),
}));

vi.mock("@vibecodr/shared", () => ({
  ApiPostResponseSchema: {
    parse: (payload: unknown) => payload,
  },
}));

vi.mock("@/lib/seo", () => ({
  usePageMeta: (...args: unknown[]) => mockUsePageMeta(...args),
}));

describe("routes navigation", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockPostsGet.mockReset();
    mockProfileGet.mockReset();
    mockMapPost.mockReset();
    mockUsePageMeta.mockReset();
    mockParams = {};
  });

  it("redirects app posts to /player/:id without stray whitespace", async () => {
    const postId = "post-abc";
    mockParams = { id: postId };

    mockPostsGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ post: { id: postId, type: "app" } }),
    });
    mockMapPost.mockReturnValue({ id: postId, type: "app" });

    render(<PostDetailRoute />);

    await waitFor(() => expect(mockPostsGet).toHaveBeenCalledWith(postId));
    await waitFor(() => expect(mockMapPost).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/player/${postId}`, { replace: true })
    );
  });

  it("redirects legacy profile route to /u/:handle without whitespace and with encoding", async () => {
    const handle = "Space User";
    mockParams = { handle };

    render(<LegacyProfileRouteWrapper />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(`/u/${encodeURIComponent(handle)}`, { replace: true })
    );
  });
});
