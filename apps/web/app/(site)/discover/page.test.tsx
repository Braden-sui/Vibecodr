import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DiscoverPage from "./page";

const mockDiscover = vi.fn();
const mockMapPost = vi.fn();

vi.mock("@/lib/api", () => ({
  postsApi: {
    discover: (...args: unknown[]) => mockDiscover(...args),
  },
  mapApiFeedPostToFeedPost: (...args: unknown[]) => mockMapPost(...args),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  trackClientError: vi.fn(),
}));

vi.mock("@vibecodr/shared", () => ({
  ApiFeedResponseSchema: {
    parse: (value: unknown) => value,
  },
}));

vi.mock("@/components/FeedCard", () => ({
  FeedCard: ({
    post,
    onPostModerated,
  }: {
    post: { title: string };
    onPostModerated?: (postId: string, action: "quarantine" | "remove") => void;
  }) => (
    <div data-testid="discover-card" data-moderated={Boolean(onPostModerated)}>
      {post.title}
    </div>
  ),
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    getToken: vi.fn(async () => null),
  }),
}));

describe("DiscoverPage", () => {
  beforeEach(() => {
    mockDiscover.mockReset();
    mockMapPost.mockReset();
    mockMapPost.mockImplementation((apiPost: any) => ({
      id: String(apiPost.id || "p1"),
      title: apiPost.title || "mapped",
      type: "app",
      author: {
        id: "author-1",
        handle: "author",
      },
      stats: { runs: 0, comments: 0, likes: 0, remixes: 0 },
      createdAt: new Date().toISOString(),
    }));
  });

  it("loads discover posts for the URL tag", async () => {
    mockDiscover.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        posts: [{ id: "p-1", title: "Discover cli" }],
        limit: 20,
        offset: 0,
      }),
    });

    render(
      <MemoryRouter initialEntries={["/discover?tag=cli"]}>
        <DiscoverPage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(mockDiscover).toHaveBeenCalledWith("cli", { limit: 20 }, expect.any(Object))
    );
    await waitFor(() =>
      expect(screen.getByTestId("discover-card")).toHaveTextContent("Discover cli")
    );
  });

  it("refetches when selecting a tag chip", async () => {
    mockDiscover.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        posts: [],
        limit: 20,
        offset: 0,
      }),
    });

    render(
      <MemoryRouter initialEntries={["/discover"]}>
        <DiscoverPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockDiscover).toHaveBeenCalled());
    mockDiscover.mockClear();

    const cliChip = await screen.findByRole("button", { name: "#cli" });
    fireEvent.click(cliChip);

    await waitFor(() =>
      expect(mockDiscover).toHaveBeenCalledWith("cli", { limit: 20 }, expect.any(Object))
    );
  });
});
