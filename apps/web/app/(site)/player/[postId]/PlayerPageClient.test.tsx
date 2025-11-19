import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import PlayerPageClient from "./PlayerPageClient";

const iframePropsRef: { current: any } = { current: null };
const controlsPropsRef: { current: any } = { current: null };

const mockPostsGet = vi.fn();
const mockRunsComplete = vi.fn().mockResolvedValue({ ok: true });
const mockAppendLogs = vi.fn().mockResolvedValue({ ok: true });
const mockMapPost = vi.fn();

vi.mock("@/lib/api", () => ({
  postsApi: {
    get: (...args: unknown[]) => mockPostsGet(...args),
  },
  runsApi: {
    complete: (...args: unknown[]) => mockRunsComplete(...args),
    appendLogs: (...args: unknown[]) => mockAppendLogs(...args),
  },
  mapApiFeedPostToFeedPost: (...args: unknown[]) => mockMapPost(...args),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/lib/handoff", () => ({
  readPreviewHandoff: () => ({ state: null }),
}));

vi.mock("@/lib/perf", () => ({
  budgeted: (_label: string, fn: () => void) => fn(),
}));

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({ user: { publicMetadata: {} }, isSignedIn: false }),
  useAuth: () => ({
    getToken: vi.fn(async () => "test-token"),
  }),
}));

vi.mock("@/components/Player/PlayerControls", () => ({
  PlayerControls: (props: any) => {
    controlsPropsRef.current = props;
    return React.createElement("div", { "data-testid": "player-controls" });
  },
}));

vi.mock("@/components/Player/PlayerConsole", () => ({
  PlayerConsole: () => React.createElement("div", { "data-testid": "player-console" }),
}));

vi.mock("@/components/Player/PlayerDrawer", () => ({
  PlayerDrawer: () => React.createElement("div", { "data-testid": "player-drawer" }),
}));

vi.mock("@/components/Player/ParamControls", () => ({
  ParamControls: () => React.createElement("div", { "data-testid": "param-controls" }),
}));

vi.mock("@/components/Player/PlayerIframe", () => ({
  PlayerIframe: React.forwardRef((props: any, ref: React.Ref<any>) => {
    iframePropsRef.current = props;
    const bridge = {
      postMessage: () => true,
      restart: () => true,
      kill: () => true,
    };
    if (typeof ref === "function") {
      ref(bridge);
    } else if (ref && "current" in ref) {
      (ref as React.MutableRefObject<any>).current = bridge;
    }
    return React.createElement("div", { "data-testid": "mock-player-iframe" });
  }),
}));

vi.mock("@vibecodr/shared", () => ({
  ApiPostResponseSchema: {
    parse: (value: unknown) => value,
  },
}));

describe("PlayerPageClient", () => {
  beforeEach(() => {
    iframePropsRef.current = null;
    controlsPropsRef.current = null;
    mockRunsComplete.mockClear();
    mockAppendLogs.mockClear();
    mockMapPost.mockClear();
    mockPostsGet.mockReset();
    mockPostsGet.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        post: {
          id: "post-123",
          title: "Demo",
          description: "desc",
          author: { handle: "demo" },
          stats: { runs: 0, likes: 0, comments: 0, remixes: 0 },
          type: "app",
          capsule: {
            id: "capsule-1",
            runner: "html",
            params: [],
            artifactId: null,
          },
        },
      }),
    });
    mockMapPost.mockReturnValue({
      id: "post-123",
      title: "Demo",
      description: "desc",
      author: { handle: "demo" },
      stats: { runs: 0, likes: 0, comments: 0, remixes: 0 },
      type: "app",
      capsule: {
        id: "capsule-1",
        runner: "html",
        params: [],
        artifactId: null,
      },
    });
  });

  it("finalizes the run as failed when the iframe reports a runtime error", async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/player/post-123"]}>
        <PlayerPageClient postId="post-123" />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockPostsGet).toHaveBeenCalled());
    const [postIdArg, initArg] = mockPostsGet.mock.calls[0];
    expect(postIdArg).toBe("post-123");
    expect(initArg).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      })
    );
    await waitFor(() => expect(mockMapPost).toHaveBeenCalled());
    await waitFor(() => expect(iframePropsRef.current).not.toBeNull());

    act(() => {
      iframePropsRef.current?.onReady?.();
    });

    await waitFor(() => expect(controlsPropsRef.current?.isRunning).toBe(true));

    act(() => {
      iframePropsRef.current?.onError?.("runtime_crash");
    });

    await waitFor(() =>
      expect(mockRunsComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          errorMessage: "runtime_crash",
        })
      )
    );
    expect(controlsPropsRef.current?.isRunning).toBe(false);

    unmount();
  });
});
