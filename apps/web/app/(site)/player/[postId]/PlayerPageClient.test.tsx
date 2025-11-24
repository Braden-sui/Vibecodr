import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import PlayerPageClient from "./PlayerPageClient";
import { resetRuntimeSlotsForTest } from "@/components/Player/runtimeBudgets";

const playerShellPropsRef: { current: any } = { current: null };

const mockPostsGet = vi.fn();
const mockRunsStart = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ runId: "run-123" }),
});
const mockRunsComplete = vi.fn().mockResolvedValue({ ok: true });
const mockAppendLogs = vi.fn().mockResolvedValue({ ok: true });
const mockMapPost = vi.fn();
const mockToast = vi.fn();

vi.mock("@/lib/api", () => ({
  postsApi: {
    get: (...args: unknown[]) => mockPostsGet(...args),
  },
  runsApi: {
    start: (...args: unknown[]) => mockRunsStart(...args),
    complete: (...args: unknown[]) => mockRunsComplete(...args),
    appendLogs: (...args: unknown[]) => mockAppendLogs(...args),
  },
  mapApiFeedPostToFeedPost: (...args: unknown[]) => mockMapPost(...args),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  trackClientError: vi.fn(),
  trackRuntimeEvent: vi.fn(),
}));

vi.mock("@/lib/handoff", () => ({
  readPreviewHandoff: () => ({ state: null }),
}));

vi.mock("@/lib/perf", () => ({
  budgeted: (_label: string, fn: () => void) => fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({ user: { publicMetadata: {} }, isSignedIn: false }),
  useAuth: () => ({
    getToken: vi.fn(async () => "test-token"),
  }),
}));

vi.mock("@/components/Player/PlayerDrawer", () => ({
  PlayerDrawer: () => React.createElement("div", { "data-testid": "player-drawer" }),
}));

vi.mock("@/components/Player/ParamControls", () => ({
  ParamControls: () => React.createElement("div", { "data-testid": "param-controls" }),
}));

vi.mock("@/components/PlayerShell", () => ({
  PlayerShell: React.forwardRef((props: any, ref: React.Ref<any>) => {
    playerShellPropsRef.current = props;
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
    return React.createElement("div", { "data-testid": "player-shell" });
  }),
}));

vi.mock("@vibecodr/shared", () => ({
  ApiPostResponseSchema: {
    parse: (value: unknown) => value,
  },
}));

describe("PlayerPageClient", () => {
  beforeEach(() => {
    playerShellPropsRef.current = null;
    mockRunsStart.mockClear();
    mockRunsComplete.mockClear();
    mockAppendLogs.mockClear();
    mockMapPost.mockClear();
    mockToast.mockClear();
    resetRuntimeSlotsForTest();
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
    await waitFor(() => expect(playerShellPropsRef.current).not.toBeNull());

    act(() => {
      playerShellPropsRef.current?.onReady?.();
    });

    await waitFor(() => expect(playerShellPropsRef.current?.isRunning).toBe(true));

    act(() => {
      playerShellPropsRef.current?.onError?.("runtime_crash");
    });

    await waitFor(() => expect(mockRunsComplete).toHaveBeenCalled());
    const failedCall = mockRunsComplete.mock.calls.find(([payload]) => payload.status === "failed");
    expect(failedCall?.[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        errorMessage: "runtime_crash",
      })
    );
    expect(failedCall?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      })
    );
    expect(playerShellPropsRef.current?.isRunning).toBe(false);

    unmount();
  });

  it("surfaces plan-aware messaging when run quota blocks start", async () => {
    mockRunsStart.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({
        error: "Run quota exceeded",
        code: "E-VIBECODR-0605",
        plan: "free",
        limits: { maxRuns: 5 },
        runsThisMonth: 5,
      }),
    });

    render(
      <MemoryRouter initialEntries={["/player/post-123"]}>
        <PlayerPageClient postId="post-123" />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockPostsGet).toHaveBeenCalled());
    await waitFor(() => expect(playerShellPropsRef.current).not.toBeNull());

    await act(async () => {
      playerShellPropsRef.current?.onReady?.();
    });

    await waitFor(() => expect(mockRunsStart).toHaveBeenCalled());
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    const payload = mockToast.mock.calls[mockToast.mock.calls.length - 1]?.[0];
    expect(payload).toEqual(
      expect.objectContaining({
        title: expect.stringContaining("Free plan"),
      })
    );
    expect(String(payload?.description ?? "")).toMatch(/free plan/i);
    expect(mockRunsComplete).not.toHaveBeenCalled();
  });
});
