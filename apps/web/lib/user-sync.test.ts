import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ensureUserSynced, __resetUserSyncForTests } from "./user-sync";

declare global {
  // eslint-disable-next-line no-var
  var window: Record<string, unknown> | undefined;
}

describe("ensureUserSynced", () => {
  beforeEach(() => {
    __resetUserSyncForTests();
    global.window = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete global.window;
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
    let resolveSync: (() => void) | null = null;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = () =>
            resolve({
              ok: true,
              status: 200,
              text: async () => "",
            });
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const call1 = ensureUserSynced();
    const call2 = ensureUserSynced();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveSync?.();
    await Promise.all([call1, call2]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
