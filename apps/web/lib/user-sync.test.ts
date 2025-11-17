import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ensureUserSynced, __resetUserSyncForTests } from "./user-sync";

describe("ensureUserSynced", () => {
  beforeEach(() => {
    __resetUserSyncForTests();
    vi.stubGlobal("window", {} as Window & typeof globalThis);
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

    await ensureUserSynced();
    await ensureUserSynced();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/users/sync", { method: "POST" });
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

    await expect(ensureUserSynced()).rejects.toThrow();
    await ensureUserSynced();

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

    const call1 = ensureUserSynced();
    const call2 = ensureUserSynced();
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
