import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { matchPath } from "react-router-dom";
import { AppRoutes, PostDetailRoute, LegacyProfileRouteWrapper } from "@/src/routes";

const mockNavigate = vi.fn();
let mockParams: Record<string, string | undefined> = {};

const mockPostsGet = vi.fn<(id: string) => Promise<unknown>>();
const mockProfileGet = vi.fn<(handle: string) => Promise<unknown>>();
const mockMapPost = vi.fn<(payload: unknown) => unknown>();
const mockUsePageMeta = vi.fn<(meta: unknown) => void>();
const mockCommentsFetch = vi.fn(
  async (postId: string, _options?: unknown) =>
    new Response(JSON.stringify({ comments: [], postId }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
);

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
    get: (id: string) => mockPostsGet(id),
  },
  profileApi: {
    get: (handle: string) => mockProfileGet(handle),
  },
  mapApiFeedPostToFeedPost: (payload: unknown) => mockMapPost(payload),
  commentsApi: {
    fetch: (postId: string, options?: unknown) => mockCommentsFetch(postId, options),
    create: vi.fn(async () => new Response(JSON.stringify({ comment: null }), { status: 200 })),
    delete: vi.fn(async () => new Response(null, { status: 204 })),
  },
  moderationApi: {
    moderateComment: vi.fn(async () => new Response(null, { status: 200 })),
  },
}));

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({ user: null, isSignedIn: false, isLoaded: true }),
  useAuth: () => ({ getToken: vi.fn(async () => "test-token") }),
  SignIn: () => <div data-testid="clerk-sign-in" />,
  SignUp: () => <div data-testid="clerk-sign-up" />,
  UserButton: () => <div data-testid="clerk-user-button" />,
}));

vi.mock("@vibecodr/shared", () => ({
  ApiPostResponseSchema: {
    parse: (payload: unknown) => payload,
  },
}));

vi.mock("@/lib/seo", () => ({
  usePageMeta: (meta: unknown) => mockUsePageMeta(meta),
}));

describe("routes navigation", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockPostsGet.mockReset();
    mockProfileGet.mockReset();
    mockMapPost.mockReset();
    mockUsePageMeta.mockReset();
    mockCommentsFetch.mockClear();
    mockParams = {};
  });

  it("keeps navigation and SEO-critical paths wired in AppRoutes", () => {
    const appRoutesElement = <AppRoutes />;
    const routePatterns: string[] = [];
    const walk = (node: React.ReactNode) => {
      React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) {
          return;
        }
        if (typeof child.props.path === "string") {
          routePatterns.push(child.props.path);
        }
        if (child.props.children) {
          walk(child.props.children);
        }
      });
    };

    walk(appRoutesElement);
    const seoAndNavPaths = [
      "/",
      "/discover",
      "/post/new",
      "/composer",
      "/post/example-post",
      "/player/example-post",
      "/u/example-user",
      "/profile/example-user",
      "/pricing",
      "/live",
      "/report/new",
      "/settings",
      "/settings/profile",
      "/studio/alpha",
      "/moderation/flagged",
      "/moderation/audit",
      "/admin/moderation",
      "/admin/analytics",
      "/sign-in",
      "/sign-up",
    ];

    expect(routePatterns.length).toBeGreaterThan(0);

    const unmatched = seoAndNavPaths.filter(
      (path) => !routePatterns.some((pattern) => !!matchPath({ path: pattern, end: false }, path))
    );

    expect(unmatched).toEqual([]);
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

  it("emits canonical and oEmbed URLs for post detail meta", async () => {
    mockParams = { id: "nav-meta" };
    mockPostsGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        post: {
          id: "nav-meta",
          type: "thought",
          title: "Meta test",
          description: "Meta description",
          author: { handle: "tester" },
          stats: { runs: 0, likes: 0, comments: 0, remixes: 0 },
          createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
        },
      }),
    });
    mockMapPost.mockReturnValue({
      id: "nav-meta",
      type: "thought",
      title: "Meta test",
      description: "Meta description",
      author: { handle: "tester" },
      stats: { runs: 0, likes: 0, comments: 0, remixes: 0 },
      createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
    });

    render(<PostDetailRoute />);

    await waitFor(() => expect(mockPostsGet).toHaveBeenCalled());

    const meta = mockUsePageMeta.mock.calls.at(-1)?.[0] as
      | { canonicalUrl?: string; oEmbedUrl?: string; url?: string }
      | undefined;

    expect(meta?.canonicalUrl).toMatch(/\/post\/nav-meta$/);
    expect(meta?.url).toBe(meta?.canonicalUrl);
    expect(meta?.oEmbedUrl).toContain(encodeURIComponent(meta?.canonicalUrl ?? ""));
  });
});
