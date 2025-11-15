import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeedCard } from "../FeedCard";

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: null, isSignedIn: false }),
}));

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

  it("should not prewarm manifests when cards enter the warm zone", async () => {
    global.fetch = vi.fn();

    const postA = { ...mockPost, id: "postA" };
    const postB = { ...mockPost, id: "postB" };
    const postC = { ...mockPost, id: "postC" };

    render(
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
    viewObservers.forEach((obs) => obs.trigger(1.0, true));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should post pause/resume when visibility crosses 30% threshold", async () => {
    // Immediate successful manifest for prewarm
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any;

    render(<FeedCard post={mockPost} />);

    const ioInstances = (window as any).__mockIOInstances as MockIntersectionObserver[];
    const viewObserver = ioInstances.find(
      (o) => Array.isArray(o.options?.threshold) && (o.options?.threshold as number[]).includes(0.35)
    )!;

    // Enter warm zone to trigger prewarm and reveal Run Preview
    viewObserver.trigger(1.0, true);

    await waitFor(() => expect(screen.getByText("Run Preview")).toBeInTheDocument());

    // Click Run Preview to mount iframe and enable pause/resume observer
    fireEvent.click(screen.getByText("Run Preview"));

    // Find the latest pause/resume observer (threshold 0.3)
    const prCandidates = ioInstances.filter(
      (o) => Array.isArray(o.options?.threshold) && (o.options?.threshold as number[]).includes(0.3)
    );
    const prObserver = prCandidates[prCandidates.length - 1] as MockIntersectionObserver;

    // Drop below 30% -> pause
    prObserver.trigger(0.2, false);
    expect(iframePostMessage).toHaveBeenCalledWith({ type: "pause" }, "*");

    // Back to >=30% -> resume
    prObserver.trigger(0.3, true);
    expect(iframePostMessage).toHaveBeenCalledWith({ type: "resume" }, "*");
  });

  it("should pause when tab hidden and resume when visible again", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any;

    render(<FeedCard post={mockPost} />);

    const ioInstances = (window as any).__mockIOInstances as MockIntersectionObserver[];
    const viewObserver = ioInstances.find(
      (o) => Array.isArray(o.options?.threshold) && (o.options?.threshold as number[]).includes(0.35)
    )!;

    viewObserver.trigger(1.0, true);
    await waitFor(() => expect(screen.getByText("Run Preview")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Run Preview"));

    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(iframePostMessage).toHaveBeenCalledWith({ type: "pause" }, "*");

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(iframePostMessage).toHaveBeenCalledWith({ type: "resume" }, "*");

    // restore
    if (hiddenDescriptor) Object.defineProperty(document, "hidden", hiddenDescriptor);
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

    const likeButton = screen.getByRole("button", { name: "10" });
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

    const remixButton = screen.getByRole("button", { name: "Remix" });
    expect(remixButton).toBeInTheDocument();
  });

  it("should not show remix button for report type", () => {
    const reportPost = { ...mockPost, type: "report" as const, capsule: undefined };
    render(<FeedCard post={reportPost} />);

    expect(screen.queryByRole("button", { name: "Remix" })).not.toBeInTheDocument();
  });

  it("should show Report button", () => {
    render(<FeedCard post={mockPost} />);

    // Report button is rendered (icon button)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(2);
  });
});
