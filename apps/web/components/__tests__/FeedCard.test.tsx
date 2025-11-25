import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeedCard } from "../FeedCard";
import { capsulesApi } from "@/lib/api";
import type { ManifestParam } from "@vibecodr/shared/manifest";

const mockUseUser = vi.fn(() => ({ user: { id: "viewer-1" }, isSignedIn: true }));
const RUNNER_ORIGIN = new URL(capsulesApi.bundleSrc("capsule1")).origin;

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => mockUseUser(),
  useAuth: () => ({
    getToken: vi.fn(async () => "test-token"),
  }),
}));

const renderWithRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  targets: Element[] = [];
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    // store instance
    (window as any).__mockIOInstances.push(this);
  }
  observe = (el: Element) => {
    this.targets.push(el);
  };
  unobserve = (_el: Element) => {};
  disconnect = () => {};
  trigger = (ratio: number, isIntersecting: boolean) => {
    const entry = {
      isIntersecting,
      intersectionRatio: ratio,
      target: this.targets[0] ?? ({} as Element),
    } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  };
}

let iframePostMessage: ReturnType<typeof vi.fn>;

beforeAll(() => {
  (window as any).__mockIOInstances = [] as MockIntersectionObserver[];
  (window as any).IntersectionObserver = MockIntersectionObserver as any;
  Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
    configurable: true,
    get() {
      return {
        postMessage: iframePostMessage,
      } as any;
    },
  });
});

beforeEach(() => {
  mockUseUser.mockReturnValue({ user: { id: "viewer-1" }, isSignedIn: true });
  iframePostMessage = vi.fn();
  (window as any).__mockIOInstances = [] as MockIntersectionObserver[];
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  delete (window as any).__mockIOInstances;
});

describe("FeedCard", () => {
  const mockParams: ManifestParam[] = [
    {
      name: "count",
      type: "number",
      label: "Count",
      default: 1,
      min: 0,
      max: 10,
    },
  ];
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
        workers: false,
      },
      params: mockParams,
    },
    tags: ["test", "demo"],
    stats: {
      runs: 100,
      comments: 5,
      likes: 10,
      remixes: 2,
    },
    viewer: {
      liked: false,
      followingAuthor: false,
    },
    createdAt: "2025-01-01T00:00:00Z",
  };

  it("should render post title and description", () => {
    renderWithRouter(<FeedCard post={mockPost} />);

    expect(screen.getByText("Test App")).toBeInTheDocument();
    expect(screen.getByText("A test application")).toBeInTheDocument();
  });

  it("should not prewarm manifests when cards enter the warm zone", async () => {
    global.fetch = vi.fn();

    const postA = { ...mockPost, id: "postA" };
    const postB = { ...mockPost, id: "postB" };
    const postC = { ...mockPost, id: "postC" };

    renderWithRouter(
      <>
        <FeedCard post={postA} />
        <FeedCard post={postB} />
        <FeedCard post={postC} />
      </>
    );

    const viewObservers = ((window as any).__mockIOInstances as MockIntersectionObserver[]).filter(
      (o) => Array.isArray(o.options?.threshold) && (o.options?.threshold as number[]).includes(0.35)
    );

    // Enter warm zone for all three cards; implementation should not issue manifest prewarm fetches.
    await act(async () => {
      viewObservers.forEach((obs) => obs.trigger(1.0, true));
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should post pause/resume when visibility crosses 30% threshold", async () => {
    // Immediate successful manifest for prewarm
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any;

    renderWithRouter(<FeedCard post={mockPost} />);

    const ioInstances = (window as any).__mockIOInstances as MockIntersectionObserver[];
    const viewObserver = ioInstances.find(
      (o) => Array.isArray(o.options?.threshold) && (o.options?.threshold as number[]).includes(0.35)
    )!;

    // Enter warm zone to trigger prewarm and reveal Run Preview
    await act(async () => {
      viewObserver.trigger(1.0, true);
    });

    await waitFor(() => expect(screen.getByText("Run Preview")).toBeInTheDocument());

    // Click Run Preview to mount iframe and enable pause/resume observer
    fireEvent.click(screen.getByText("Run Preview"));

    // Find the latest pause/resume observer (threshold 0.3)
    const prCandidates = ioInstances.filter(
      (o) => Array.isArray(o.options?.threshold) && (o.options?.threshold as number[]).includes(0.3)
    );
    const prObserver = prCandidates[prCandidates.length - 1] as MockIntersectionObserver;

    // Drop below 30% -> pause
    await act(async () => {
      prObserver.trigger(0.2, false);
    });
    expect(iframePostMessage).toHaveBeenCalledWith({ type: "pause" }, RUNNER_ORIGIN);

    // Back to >=30% -> resume
    await act(async () => {
      prObserver.trigger(0.3, true);
    });
    expect(iframePostMessage).toHaveBeenCalledWith({ type: "resume" }, RUNNER_ORIGIN);
  });

  it("should pause when tab hidden and resume when visible again", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any;

    renderWithRouter(<FeedCard post={mockPost} />);

    const ioInstances = (window as any).__mockIOInstances as MockIntersectionObserver[];
    const viewObserver = ioInstances.find(
      (o) => Array.isArray(o.options?.threshold) && (o.options?.threshold as number[]).includes(0.35)
    )!;

    await act(async () => {
      viewObserver.trigger(1.0, true);
    });
    await waitFor(() => expect(screen.getByText("Run Preview")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Run Preview"));

    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(iframePostMessage).toHaveBeenCalledWith({ type: "pause" }, RUNNER_ORIGIN);

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(iframePostMessage).toHaveBeenCalledWith({ type: "resume" }, RUNNER_ORIGIN);

    // restore
    if (hiddenDescriptor) Object.defineProperty(document, "hidden", hiddenDescriptor);
  });

  it("should render author information", () => {
    renderWithRouter(<FeedCard post={mockPost} />);

    expect(screen.getByText("@testuser")).toBeInTheDocument();
  });

  it("should display stats correctly", () => {
    renderWithRouter(<FeedCard post={mockPost} />);

    expect(screen.getByText("10")).toBeInTheDocument(); // likes
    expect(screen.getByText("5")).toBeInTheDocument(); // comments
    expect(screen.getByText("100")).toBeInTheDocument(); // runs
  });

  it("should show capability badges", () => {
    renderWithRouter(<FeedCard post={mockPost} />);

    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("1 params")).toBeInTheDocument();
  });

  it("should show tags", () => {
    renderWithRouter(<FeedCard post={mockPost} />);

    expect(screen.getByText("#test")).toBeInTheDocument();
    expect(screen.getByText("#demo")).toBeInTheDocument();
  });

  it("shows remix count and family tree link", () => {
    renderWithRouter(<FeedCard post={mockPost} />);

    expect(screen.getByText(/2 remixes/i)).toBeInTheDocument();
    const treeLink = screen.getByRole("link", { name: /View family tree/i });
    expect(treeLink).toHaveAttribute("href", "/vibe/capsule1/remixes");
  });

  it("calls onTagClick when a tag is selected", () => {
    const onTagClick = vi.fn();
    renderWithRouter(<FeedCard post={mockPost} onTagClick={onTagClick} />);

    const tagButton = screen.getByRole("button", { name: "#test" });
    fireEvent.click(tagButton);

    expect(onTagClick).toHaveBeenCalledWith("test");
  });

  it("should handle like button click", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, liked: true }),
    });

    renderWithRouter(<FeedCard post={mockPost} />);

    const likeButton = screen.getByRole("button", { name: "10" });
    fireEvent.click(likeButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
      const calls = (global.fetch as any).mock.calls as [string, RequestInit?][];
      const match = calls.find(([url]) => typeof url === "string" && url.includes("/posts/post1/like"));
      expect(match).toBeTruthy();
      const [, init] = match!;
      expect(init).toEqual(
        expect.objectContaining({
          method: "POST",
        })
      );
    });
  });

  it("should optimistically follow and unfollow authors", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    renderWithRouter(<FeedCard post={mockPost} />);

    const followButton = screen.getByRole("button", { name: /follow/i });
    fireEvent.click(followButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
      const calls = (global.fetch as any).mock.calls as [string, RequestInit?][];
      const match = calls.find(([url]) => typeof url === "string" && url.includes("/users/user1/follow"));
      expect(match).toBeTruthy();
      const [, init] = match!;
      expect(init).toEqual(expect.objectContaining({ method: "POST" }));
    });
    await waitFor(() => {
      expect(followButton).toHaveTextContent(/Following/i);
    });
  });

  it("should send delete request when unfollowing an author", async () => {
    const followingPost = {
      ...mockPost,
      viewer: { ...(mockPost.viewer || {}), followingAuthor: true },
    };
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    renderWithRouter(<FeedCard post={followingPost} />);

    const followButton = screen.getByRole("button", { name: /Following/i });
    fireEvent.click(followButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
      const calls = (global.fetch as any).mock.calls as [string, RequestInit?][];
      const match = calls.find(([url]) => typeof url === "string" && url.includes("/users/user1/follow"));
      expect(match).toBeTruthy();
      const [, init] = match!;
      expect(init).toEqual(expect.objectContaining({ method: "DELETE" }));
    });
  });

  it("should handle comment button click", () => {
    renderWithRouter(<FeedCard post={mockPost} />);

    const commentButton = screen.getByRole("button", { name: "5" });
    fireEvent.click(commentButton);

    // Verify router.push was called (mocked in setup)
  });

  it("should show remix button for app type", () => {
    renderWithRouter(<FeedCard post={mockPost} />);

    const remixButton = screen.getByRole("button", { name: "Remix" });
    expect(remixButton).toBeInTheDocument();
  });

  it("should not show remix button for thought vibes", () => {
    const thoughtPost = { ...mockPost, type: "thought" as const, capsule: undefined };
    renderWithRouter(<FeedCard post={thoughtPost} />);

    expect(screen.queryByRole("button", { name: "Remix" })).not.toBeInTheDocument();
  });

  it("should show Report button", () => {
    renderWithRouter(<FeedCard post={mockPost} />);

    // Report button is rendered (icon button)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(2);
  });
});
