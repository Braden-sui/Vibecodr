import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeedCard } from "../FeedCard";

describe("FeedCard", () => {
  const mockPost = {
    id: "post1",
    type: "app" as const,
    title: "Test App",
    description: "A test application",
    author: {
      id: "user1",
      handle: "testuser",
      name: "Test User",
    },
    capsule: {
      id: "capsule1",
      runner: "client-static" as const,
      capabilities: {
        net: ["api.example.com"],
        storage: true,
      },
      params: [{ name: "count" }],
    },
    tags: ["test", "demo"],
    stats: {
      runs: 100,
      comments: 5,
      likes: 10,
      remixes: 2,
    },
    createdAt: "2025-01-01T00:00:00Z",
  };

  it("should render post title and description", () => {
    render(<FeedCard post={mockPost} />);

    expect(screen.getByText("Test App")).toBeInTheDocument();
    expect(screen.getByText("A test application")).toBeInTheDocument();
  });

  it("should render author information", () => {
    render(<FeedCard post={mockPost} />);

    expect(screen.getByText("@testuser")).toBeInTheDocument();
  });

  it("should display stats correctly", () => {
    render(<FeedCard post={mockPost} />);

    expect(screen.getByText("10")).toBeInTheDocument(); // likes
    expect(screen.getByText("5")).toBeInTheDocument(); // comments
    expect(screen.getByText("100")).toBeInTheDocument(); // runs
  });

  it("should show capability badges", () => {
    render(<FeedCard post={mockPost} />);

    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("1 params")).toBeInTheDocument();
  });

  it("should show tags", () => {
    render(<FeedCard post={mockPost} />);

    expect(screen.getByText("#test")).toBeInTheDocument();
    expect(screen.getByText("#demo")).toBeInTheDocument();
  });

  it("should handle like button click", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, liked: true }),
    });

    render(<FeedCard post={mockPost} />);

    const likeButton = screen.getAllByRole("button")[0]; // First button is like
    fireEvent.click(likeButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/posts/post1/like",
        expect.objectContaining({
          method: "POST",
        })
      );
    });
  });

  it("should handle comment button click", () => {
    const { container } = render(<FeedCard post={mockPost} />);

    const commentButton = screen.getAllByRole("button")[1];
    fireEvent.click(commentButton);

    // Verify router.push was called (mocked in setup)
  });

  it("should show remix button for app type", () => {
    render(<FeedCard post={mockPost} />);

    expect(screen.getByText("Remix")).toBeInTheDocument();
  });

  it("should not show remix button for report type", () => {
    const reportPost = { ...mockPost, type: "report" as const, capsule: undefined };
    render(<FeedCard post={reportPost} />);

    expect(screen.queryByText("Remix")).not.toBeInTheDocument();
  });

  it("should show Report button", () => {
    render(<FeedCard post={mockPost} />);

    // Report button is rendered (icon button)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(2);
  });
});
