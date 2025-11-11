import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell } from "../Notifications";

describe("NotificationBell", () => {
  const mockNotifications = [
    {
      id: "notif1",
      type: "like" as const,
      read: false,
      createdAt: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
      actor: {
        id: "user1",
        handle: "alice",
        name: "Alice",
      },
      post: {
        id: "post1",
        title: "My Awesome App",
      },
    },
    {
      id: "notif2",
      type: "comment" as const,
      read: false,
      createdAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      actor: {
        id: "user2",
        handle: "bob",
      },
      post: {
        id: "post2",
        title: "Cool Animation",
      },
    },
    {
      id: "notif3",
      type: "follow" as const,
      read: true,
      createdAt: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
      actor: {
        id: "user3",
        handle: "charlie",
      },
    },
    {
      id: "notif4",
      type: "remix" as const,
      read: false,
      createdAt: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
      actor: {
        id: "user4",
        handle: "diana",
      },
      post: {
        id: "post3",
        title: "Interactive Game",
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should render notification bell button", () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0 }),
    });

    render(<NotificationBell />);

    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });

  it("should fetch and display unread count", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 3 }),
    });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  it("should display '9+' for more than 9 unread notifications", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 15 }),
    });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByText("9+")).toBeInTheDocument();
    });
  });

  it("should poll for unread count every 30 seconds", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ count: 2 }),
    });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Fast-forward 30 seconds
    vi.advanceTimersByTime(30000);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it("should fetch notifications when dropdown opens", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: mockNotifications }),
      });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    const button = screen.getByRole("button");
    await user.click(button);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/notifications?limit=20",
        expect.any(Object)
      );
    });
  });

  it("should display notifications with correct icons and text", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: mockNotifications }),
      });

    render(<NotificationBell />);

    const button = screen.getByRole("button");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText("@alice")).toBeInTheDocument();
      expect(screen.getByText(/liked your post/i)).toBeInTheDocument();
      expect(screen.getByText("@bob")).toBeInTheDocument();
      expect(screen.getByText(/commented on your post/i)).toBeInTheDocument();
      expect(screen.getByText("@charlie")).toBeInTheDocument();
      expect(screen.getByText(/started following you/i)).toBeInTheDocument();
      expect(screen.getByText("@diana")).toBeInTheDocument();
      expect(screen.getByText(/remixed your capsule/i)).toBeInTheDocument();
    });
  });

  it("should show empty state when no notifications", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: [] }),
      });

    render(<NotificationBell />);

    const button = screen.getByRole("button");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/No notifications yet/i)).toBeInTheDocument();
    });
  });

  it("should highlight unread notifications", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: mockNotifications }),
      });

    render(<NotificationBell />);

    const button = screen.getByRole("button");
    await user.click(button);

    await waitFor(() => {
      const aliceNotif = screen.getByText("@alice").closest("div");
      expect(aliceNotif).toHaveClass("bg-blue-50");
    });
  });

  it("should mark individual notification as read on click", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: mockNotifications }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    render(<NotificationBell />);

    const button = screen.getByRole("button");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText("@alice")).toBeInTheDocument();
    });

    const aliceLink = screen.getByText("@alice").closest("a");
    fireEvent.click(aliceLink!);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/notifications/mark-read",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("notif1"),
        })
      );
    });
  });

  it("should mark all as read", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: mockNotifications }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    render(<NotificationBell />);

    const button = screen.getByRole("button");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText("Mark all read")).toBeInTheDocument();
    });

    const markAllButton = screen.getByText("Mark all read");
    await user.click(markAllButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/notifications/mark-read",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Mark all read")).not.toBeInTheDocument();
    });
  });

  it("should update unread count after marking as read", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: mockNotifications }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    const button = screen.getByRole("button");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText("Mark all read")).toBeInTheDocument();
    });

    const markAllButton = screen.getByText("Mark all read");
    await user.click(markAllButton);

    await waitFor(() => {
      expect(screen.queryByText("3")).not.toBeInTheDocument();
    });
  });

  it("should navigate to correct URL on notification click", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: mockNotifications }),
      });

    render(<NotificationBell />);

    const button = screen.getByRole("button");
    await user.click(button);

    await waitFor(() => {
      const likeLink = screen.getByText("@alice").closest("a");
      expect(likeLink).toHaveAttribute("href", "/player/post1");

      const followLink = screen.getByText("@charlie").closest("a");
      expect(followLink).toHaveAttribute("href", "/profile/charlie");
    });
  });

  it("should format relative time correctly", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ notifications: mockNotifications }),
      });

    render(<NotificationBell />);

    const button = screen.getByRole("button");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/5m ago/)).toBeInTheDocument();
      expect(screen.getByText(/1h ago/)).toBeInTheDocument();
      expect(screen.getByText(/2h ago/)).toBeInTheDocument();
      expect(screen.getByText(/1d ago/)).toBeInTheDocument();
    });
  });

  it("should handle API errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(<NotificationBell />);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to fetch unread count:",
        expect.any(Error)
      );
    });

    consoleSpy.mockRestore();
  });
});
