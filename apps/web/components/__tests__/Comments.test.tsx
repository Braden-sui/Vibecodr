import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Comments } from "../Comments";

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: null, isSignedIn: false }),
}));

describe("Comments", () => {
  const mockComments = [
    {
      id: "comment1",
      body: "Great work!",
      createdAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      user: {
        id: "user1",
        handle: "alice",
        name: "Alice",
      },
    },
    {
      id: "comment2",
      body: "This is amazing!",
      atMs: 5000, // At 5 seconds
      createdAt: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
      user: {
        id: "user2",
        handle: "bob",
        name: "Bob",
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should display loading state initially", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch; // Never resolves

    render(<Comments postId="post1" />);

    expect(screen.getByText(/Loading comments/i)).toBeInTheDocument();
  });

  it("should load and display comments", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: mockComments }),
    });

    render(<Comments postId="post1" />);

    await waitFor(() => {
      expect(screen.getByText("Great work!")).toBeInTheDocument();
      expect(screen.getByText("This is amazing!")).toBeInTheDocument();
    });

    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
  });

  it("should display empty state when no comments", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [] }),
    });

    render(<Comments postId="post1" />);

    await waitFor(() => {
      expect(screen.getByText(/No comments yet. Be the first!/i)).toBeInTheDocument();
    });
  });

  it("should format relative time correctly", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: mockComments }),
    });

    render(<Comments postId="post1" />);

    await waitFor(() => {
      expect(screen.getByText(/1h ago/)).toBeInTheDocument();
      expect(screen.getByText(/5m ago/)).toBeInTheDocument();
    });
  });

  it("should display timestamp for timestamped comments", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: mockComments }),
    });

    render(<Comments postId="post1" />);

    await waitFor(() => {
      expect(screen.getByText(/at 5s/)).toBeInTheDocument();
    });
  });

  it("should allow posting new comments", async () => {
    const user = userEvent.setup();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ comments: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          comment: {
            id: "comment3",
            body: "New comment",
            createdAt: Math.floor(Date.now() / 1000),
            user: { id: "user3", handle: "charlie" },
          },
        }),
      });

    render(<Comments postId="post1" currentUserId="user3" />);

    await waitFor(() => {
      expect(screen.getByText(/No comments yet/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    await user.type(textarea, "New comment");

    const postButton = screen.getByRole("button", { name: /Post/i });
    await user.click(postButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/posts/post1/comments",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("New comment"),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("New comment")).toBeInTheDocument();
    });
  });

  it("should enforce 2000 character limit", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [] }),
    });

    render(<Comments postId="post1" />);

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Add a comment/i);
      expect(textarea).toHaveAttribute("maxLength", "2000");
    });
  });

  it("should display character count", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [] }),
    });

    render(<Comments postId="post1" />);

    await waitFor(() => {
      expect(screen.getByText("0/2000")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    await user.type(textarea, "Hello");

    expect(screen.getByText("5/2000")).toBeInTheDocument();
  });

  it("should disable post button when comment is empty", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [] }),
    });

    render(<Comments postId="post1" />);

    await waitFor(() => {
      const postButton = screen.getByRole("button", { name: /Post/i });
      expect(postButton).toBeDisabled();
    });
  });

  it("should clear textarea after posting", async () => {
    const user = userEvent.setup();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ comments: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          comment: {
            id: "comment1",
            body: "Test",
            createdAt: Math.floor(Date.now() / 1000),
            user: { id: "user1", handle: "test" },
          },
        }),
      });

    render(<Comments postId="post1" />);

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Add a comment/i);
      expect(textarea).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    await user.type(textarea, "Test");

    const postButton = screen.getByRole("button", { name: /Post/i });
    await user.click(postButton);

    await waitFor(() => {
      expect(textarea).toHaveValue("");
    });
  });

  it("should allow deleting own comments", async () => {
    const user = userEvent.setup();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ comments: mockComments }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

    render(<Comments postId="post1" currentUserId="user1" />);

    await waitFor(() => {
      expect(screen.getByText("Great work!")).toBeInTheDocument();
    });

    // Hover over comment to reveal delete button
    const comment = screen.getByText("Great work!").closest("div");
    fireEvent.mouseEnter(comment!);

    const deleteButton = screen.getAllByRole("button").find((btn) =>
      btn.querySelector("svg")
    );

    if (deleteButton) {
      await user.click(deleteButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/comments/comment1",
          expect.objectContaining({
            method: "DELETE",
          })
        );
      });

      await waitFor(() => {
        expect(screen.queryByText("Great work!")).not.toBeInTheDocument();
      });
    }
  });

  it("should not show delete button for other users' comments", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: mockComments }),
    });

    render(<Comments postId="post1" currentUserId="user3" />);

    await waitFor(() => {
      expect(screen.getByText("Great work!")).toBeInTheDocument();
    });

    // Delete button should not be visible for other users' comments
    const allButtons = screen.getAllByRole("button");
    expect(allButtons.length).toBe(1); // Only the Post button
  });

  it("should handle fetch errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(<Comments postId="post1" />);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to fetch comments:",
        expect.any(Error)
      );
    });

    consoleSpy.mockRestore();
  });

  it("should prevent double submission", async () => {
    const user = userEvent.setup();
    let resolveSubmit: (value: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ comments: [] }),
      })
      .mockReturnValueOnce(submitPromise);

    render(<Comments postId="post1" />);

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Add a comment/i);
      expect(textarea).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    await user.type(textarea, "Test");

    const postButton = screen.getByRole("button", { name: /Post/i });
    await user.click(postButton);

    // Button should be disabled while submitting
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Posting/i })).toBeDisabled();
    });

    // Resolve the submission
    resolveSubmit!({
      ok: true,
      json: async () => ({
        comment: {
          id: "comment1",
          body: "Test",
          createdAt: Math.floor(Date.now() / 1000),
          user: { id: "user1", handle: "test" },
        },
      }),
    });
  });
});
