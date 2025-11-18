import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ensureUserSynced, __resetUserSyncForTests } from "./user-sync";

describe("ensureUserSynced", () => {
  beforeEach(() => {
    __resetUserSyncForTests();
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    process.env.WORKER_API_BASE = "https://worker.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to sync endpoint once per session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      user: {
        id: "user_123",
        handle: "signedin",
        name: "Signed In",
        avatarUrl: "https://avatar.cdn/test.png",
        bio: null,
        plan: undefined,
      },
      token: "test-worker-token",
    } as const;

    await ensureUserSynced(input);
    await ensureUserSynced(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://worker.test/users/sync");
  });

  it("retries after a failed sync", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "boom",
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      user: {
        id: "user_123",
        handle: "signedin",
        name: "Signed In",
        avatarUrl: "https://avatar.cdn/test.png",
        bio: null,
        plan: undefined,
      },
      token: "test-worker-token",
    } as const;

    await expect(ensureUserSynced(input)).rejects.toThrow();
    await ensureUserSynced(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares the same inflight request across concurrent callers", async () => {
    type MockResponse = { ok: boolean; status: number; text: () => Promise<string> };
    let pendingResolve!: (value: MockResponse) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<MockResponse>((resolve) => {
          pendingResolve = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      user: {
        id: "user_123",
        handle: "signedin",
        name: "Signed In",
        avatarUrl: "https://avatar.cdn/test.png",
        bio: null,
        plan: undefined,
      },
      token: "test-worker-token",
    } as const;

    const call1 = ensureUserSynced(input);
    const call2 = ensureUserSynced(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pendingResolve({
      ok: true,
      status: 200,
      text: async () => "",
    });
    await Promise.all([call1, call2]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
