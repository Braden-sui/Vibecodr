import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomePageClient from "./HomePageClient";

const mockList = vi.fn();
const mockMapPost = vi.fn();

vi.mock("@/lib/api", () => ({
  postsApi: {
    list: (...args: unknown[]) => mockList(...args),
  },
  mapApiFeedPostToFeedPost: (...args: unknown[]) => mockMapPost(...args),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  trackClientError: vi.fn(),
}));

vi.mock("@/components/FeedCard", () => ({
  FeedCard: ({ post }: { post: { title: string } }) => (
    <div data-testid="feed-card">{post.title}</div>
  ),
}));

vi.mock("@/components/VibesComposer", () => ({
  VibesComposer: () => <div data-testid="vibes-composer" />,
}));

vi.mock("@vibecodr/shared", () => ({
  ApiFeedResponseSchema: {
    parse: (value: unknown) => value,
  },
}));

describe("HomePageClient feed data source", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockMapPost.mockReset();
    mockMapPost.mockImplementation((apiPost: any) => ({
      id: String(apiPost.id),
      title: apiPost.title || "from-worker",
      author: {
        id: "author-1",
        handle: "worker-author",
      },
      stats: { runs: 0, comments: 0, likes: 0, remixes: 0 },
      createdAt: new Date().toISOString(),
    }));

    mockList.mockImplementation((params: any) => {
      const mode = params?.mode ?? "latest";
      const tags = Array.isArray(params?.tags) ? params.tags : [];
      const tagSuffix = tags.length > 0 ? ` [${tags.join(",")}]` : "";
      return Promise.resolve({
        ok: true,
        json: async () => ({
          posts: [
            {
              id: `post-${mode}`,
              title: `Worker post ${mode}${tagSuffix}`,
            },
          ],
          mode,
          limit: params?.limit ?? 20,
          offset: 0,
        }),
      });
    });
  });

  it("renders posts from the Worker-backed feed for Latest mode", async () => {
    render(
      <MemoryRouter>
        <HomePageClient />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText("Worker post latest")).toBeInTheDocument()
    );
  });

  it("passes tag filters through to the Worker feed", async () => {
    console.log("test:start passes tag filters");
    render(
      <MemoryRouter>
        <HomePageClient />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    expect(screen.getAllByTestId("feed-card")[0]).toHaveTextContent("Worker post latest");

    const tagButton = screen.getByText("#canvas");
    fireEvent.click(tagButton);

    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(
        expect.objectContaining({ mode: "latest", tags: ["canvas"] })
      )
    );
    expect(screen.getAllByTestId("feed-card")[0]).toHaveTextContent("Worker post latest [canvas]");
    console.log("test:end passes tag filters");
  });

  it("does not fall back to sample posts on network errors", async () => {
    mockList.mockRejectedValueOnce(new Error("network-failure"));

    render(
      <MemoryRouter>
        <HomePageClient />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(
        screen.getByText("Feed temporarily unavailable. Please try again.")
      ).toBeInTheDocument()
    );

    expect(
      screen.queryByText("Interactive Boids Simulation")
    ).not.toBeInTheDocument();
  });

  it("does not render placeholder hero content when the feed is empty", async () => {
    mockList.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        posts: [],
        mode: "latest",
        limit: 20,
        offset: 0,
      }),
    });

    render(
      <MemoryRouter>
        <HomePageClient />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByTestId("vibes-composer")).toBeInTheDocument()
    );

    expect(
      screen.queryByText("Interactive Boids Simulation")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Run, remix, and publish")
    ).toBeInTheDocument();
  });
});
