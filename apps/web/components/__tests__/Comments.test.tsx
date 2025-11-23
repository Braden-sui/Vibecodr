import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mockUseUser = vi.fn(() => ({
  user: {
    id: "viewer-123",
    username: "viewer",
    fullName: "Viewer Test",
    primaryEmailAddress: { emailAddress: "viewer@example.com" },
    imageUrl: "https://example.com/avatar.png",
    publicMetadata: {},
  } as any,
  isSignedIn: true,
}));

vi.mock("@/lib/api", () => ({
  commentsApi: {
    fetch: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  moderationApi: {
    moderateComment: vi.fn(),
  },
}));

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => mockUseUser(),
  useAuth: () => ({
    getToken: vi.fn(async () => "test-token"),
  }),
}));

import { Comments } from "../Comments";
import { commentsApi, moderationApi } from "@/lib/api";

const commentsFetchMock = commentsApi.fetch as any;
const commentsCreateMock = commentsApi.create as any;
const commentsDeleteMock = commentsApi.delete as any;
const moderateCommentMock = moderationApi.moderateComment as any;

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
    mockUseUser.mockReturnValue({
      user: {
        id: "viewer-123",
        username: "viewer",
        fullName: "Viewer Test",
        primaryEmailAddress: { emailAddress: "viewer@example.com" },
        imageUrl: "https://example.com/avatar.png",
        publicMetadata: {},
      } as any,
      isSignedIn: true,
    });
    commentsFetchMock.mockReset();
    commentsCreateMock.mockReset();
    commentsDeleteMock.mockReset();
    moderateCommentMock.mockReset();
    commentsFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [] }),
    });
  });

  it("should display loading state initially", () => {
    commentsFetchMock.mockReturnValue(new Promise(() => {}) as any);

    render(<Comments postId="post1" />);

    expect(screen.getByText(/Loading comments/i)).toBeInTheDocument();
  });

  it("should load and display comments", async () => {
    commentsFetchMock.mockResolvedValue({
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
    commentsFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [] }),
    });

    render(<Comments postId="post1" />);

    await waitFor(() => {
      expect(screen.getByText(/No comments yet. Be the first!/i)).toBeInTheDocument();
    });
  });

  it("should format relative time correctly", async () => {
    commentsFetchMock.mockResolvedValue({
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
    commentsFetchMock.mockResolvedValue({
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
    let resolveCreate: ((value: any) => void) | undefined;
    const createResponse = new Promise((resolve) => {
      resolveCreate = resolve;
    });

    commentsFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ comments: [] }),
    });
    commentsCreateMock.mockImplementationOnce(() => createResponse as any);

    render(<Comments postId="post1" currentUserId="user3" />);

    await waitFor(() => {
      expect(screen.getByText(/No comments yet/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    fireEvent.change(textarea, { target: { value: "New comment" } });

    const postButton = screen.getByRole("button", { name: /Post/i });
    await user.click(postButton);

    await waitFor(() => {
      expect(commentsCreateMock).toHaveBeenCalledWith(
        "post1",
        "New comment",
        undefined,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("New comment")).toBeInTheDocument();
      expect(screen.getByText(/Sending/i)).toBeInTheDocument();
    });

    await act(async () => {
      resolveCreate?.({
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
    });

    await waitFor(() => {
      expect(screen.queryByText(/Sending/i)).not.toBeInTheDocument();
    });
  });

  it("should send parentCommentId when replying to a comment", async () => {
    const user = userEvent.setup();
    const parentComment = {
      id: "comment1",
      body: "Parent comment",
      createdAt: Math.floor(Date.now() / 1000) - 10,
      user: { id: "user1", handle: "alice" },
    };

    let resolveCreate: ((value: any) => void) | undefined;
    const createResponse = new Promise((resolve) => {
      resolveCreate = resolve;
    });

    commentsFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ comments: [parentComment] }),
    });
    commentsCreateMock.mockImplementationOnce(() => createResponse as any);

    render(<Comments postId="post1" currentUserId="viewer-123" />);

    await waitFor(() => {
      expect(screen.getByText("Parent comment")).toBeInTheDocument();
    });

    const replyButton = screen.getByRole("button", { name: /Reply/i });
    await user.click(replyButton);

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    fireEvent.change(textarea, { target: { value: "Child reply" } });

    const postButton = screen.getByRole("button", { name: /Post/i });
    await user.click(postButton);

    await waitFor(() => {
      expect(commentsCreateMock).toHaveBeenCalledWith(
        "post1",
        "Child reply",
        { parentCommentId: "comment1" },
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        })
      );
    });

    await act(async () => {
      resolveCreate?.({
        ok: true,
        json: async () => ({
          comment: {
            id: "comment2",
            body: "Child reply",
            parentCommentId: "comment1",
            createdAt: Math.floor(Date.now() / 1000),
            user: { id: "viewer-123", handle: "viewer" },
          },
        }),
      });
    });
  });

  it("should enforce 2000 character limit", async () => {
    render(<Comments postId="post1" />);

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Add a comment/i);
      expect(textarea).toHaveAttribute("maxLength", "2000");
    });
  });

  it("should display character count", async () => {
    render(<Comments postId="post1" />);

    await waitFor(() => {
      expect(screen.getByText("0/2000")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    fireEvent.change(textarea, { target: { value: "Hello" } });

    expect(screen.getByText("5/2000")).toBeInTheDocument();
  });

  it("should disable post button when comment is empty", async () => {
    render(<Comments postId="post1" />);

    await waitFor(() => {
      const postButton = screen.getByRole("button", { name: /Post/i });
      expect(postButton).toBeDisabled();
    });
  });

  it("should clear textarea after posting", async () => {
    const user = userEvent.setup();
    commentsCreateMock.mockResolvedValueOnce({
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
    fireEvent.change(textarea, { target: { value: "Test" } });

    const postButton = screen.getByRole("button", { name: /Post/i });
    await user.click(postButton);

    await waitFor(() => {
      expect(textarea).toHaveValue("");
    });
  });

  it("should allow deleting own comments", async () => {
    const user = userEvent.setup();
    commentsFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ comments: mockComments }),
    });
    commentsDeleteMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    render(<Comments postId="post1" currentUserId="user1" />);

    await waitFor(() => {
      expect(screen.getByText("Great work!")).toBeInTheDocument();
    });

    const deleteButton = screen.getByRole("button", { name: /Delete comment/i });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(commentsDeleteMock).toHaveBeenCalledWith(
        "comment1",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Great work!")).not.toBeInTheDocument();
    });
  });

  it("should not show delete button for other users' comments", async () => {
    commentsFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ comments: mockComments }),
    });

    render(<Comments postId="post1" currentUserId="user3" />);

    await waitFor(() => {
      expect(screen.getByText("Great work!")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /Delete comment/i })).not.toBeInTheDocument();
  });

  it("should handle fetch errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    commentsFetchMock.mockRejectedValue(new Error("Network error"));

    render(<Comments postId="post1" />);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith("Failed to fetch comments:", expect.any(Error));
    });

    consoleSpy.mockRestore();
  });

  it("should prevent double submission", async () => {
    const user = userEvent.setup();
    let resolveSubmit: (value: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    commentsCreateMock.mockReturnValueOnce(submitPromise as any);

    render(<Comments postId="post1" />);

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Add a comment/i);
      expect(textarea).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Add a comment/i);
    fireEvent.change(textarea, { target: { value: "Test" } });

    const postButton = screen.getByRole("button", { name: /Post/i });
    await user.click(postButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Posting/i })).toBeDisabled();
    });

    await act(async () => {
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
});
