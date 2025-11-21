import { describe, it, expect, vi } from "vitest";
import { buildLatestArtifactMap, getLatestArtifactsWithCache } from "./feed-artifacts";

describe("buildLatestArtifactMap", () => {
  it("returns the most recent artifact per capsule", () => {
    const map = buildLatestArtifactMap([
      { capsule_id: "capsule-1", id: "artifact-old", created_at: 100 },
      { capsule_id: "capsule-1", id: "artifact-new", created_at: 200 },
      { capsule_id: "capsule-2", id: "artifact-a", created_at: 50 },
      { capsule_id: "capsule-2", id: "artifact-b", created_at: 75 },
    ]);

    expect(map.get("capsule-1")).toBe("artifact-new");
    expect(map.get("capsule-2")).toBe("artifact-b");
  });

  it("ignores malformed rows and normalizes timestamps", () => {
    const map = buildLatestArtifactMap([
      { capsule_id: "capsule-x", id: null, created_at: 500 },
      { capsule_id: null, id: "artifact-x", created_at: 400 },
      { capsule_id: "capsule-x", id: "artifact-valid", created_at: "750" },
      { capsule_id: "capsule-x", id: "artifact-old", created_at: "100" },
    ]);

    expect(map.get("capsule-x")).toBe("artifact-valid");
  });
});

type ArtifactRow = {
  capsule_id: string;
  id: string;
  created_at: number | string;
  status?: string;
};

function makeDb(rows: ArtifactRow[]) {
  return {
    prepare(_query: string) {
      const state = {
        args: [] as any[],
        bind(...args: any[]) {
          state.args = args;
          return state;
        },
        async all() {
          const query = (_query || "").toLowerCase();
          const capsuleIds = (state.args as string[]) || [];
          if (query.includes("from artifacts a") && query.includes("inner join")) {
            const results = capsuleIds
              .map((capsuleId) => {
                const matches = rows.filter(
                  (row) =>
                    row.capsule_id === capsuleId &&
                    (row.status === undefined || row.status === "active")
                );
                if (matches.length === 0) return null;
                const sorted = [...matches].sort(
                  (a, b) => Number(b.created_at) - Number(a.created_at)
                );
                return sorted[0];
              })
              .filter(Boolean);
            return { results };
          }

          if (query.includes("max(created_at)")) {
            const results = capsuleIds
              .map((capsuleId) => {
                const matches = rows.filter(
                  (row) =>
                    row.capsule_id === capsuleId &&
                    (row.status === undefined || row.status === "active")
                );
                if (matches.length === 0) return null;
                const max = Math.max(...matches.map((r) => Number(r.created_at)));
                return { capsule_id: capsuleId, max_created_at: max };
              })
              .filter(Boolean);
            return { results };
          }

          // Default fallback: latest artifact per capsule
          const results = capsuleIds
            .map((capsuleId) => {
              const matches = rows.filter(
                (row) =>
                  row.capsule_id === capsuleId &&
                  (row.status === undefined || row.status === "active")
              );
              if (matches.length === 0) return null;
              const sorted = [...matches].sort(
                (a, b) => Number(b.created_at) - Number(a.created_at)
              );
              return sorted[0];
            })
            .filter(Boolean);
          return { results };
        },
      };
      return state;
    },
  };
}

function makeKv(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial || {}));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    store,
  };
}

describe("getLatestArtifactsWithCache", () => {
  it("fetches latest artifacts from DB and populates cache", async () => {
    const db = makeDb([
      { capsule_id: "capsule-1", id: "artifact-old", created_at: 1 },
      { capsule_id: "capsule-1", id: "artifact-new", created_at: 10 },
      { capsule_id: "capsule-2", id: "artifact-2", created_at: 5 },
    ]);
    const kv = makeKv();

    const result = await getLatestArtifactsWithCache(
      { DB: db as any, RUNTIME_MANIFEST_KV: kv as any } as any,
      ["capsule-1", "capsule-2"]
    );

    expect(result.get("capsule-1")?.artifactId).toBe("artifact-new");
    expect(result.get("capsule-2")?.artifactId).toBe("artifact-2");
    expect(kv.put).toHaveBeenCalledTimes(2);
    expect(kv.put).toHaveBeenCalledWith(
      "feed/latest-artifact/v1/capsule-1",
      JSON.stringify({ artifactId: "artifact-new", createdAt: 10 }),
      expect.any(Object)
    );
  });

  it("prefers cache hits and avoids DB lookup when cached", async () => {
    const kv = makeKv({
      "feed/latest-artifact/v1/capsule-1": JSON.stringify({ artifactId: "cached", createdAt: 99 }),
    });
    const db = makeDb([
      { capsule_id: "capsule-1", id: "cached", created_at: 99, status: "active" },
    ]);
    const dbPrepareSpy = vi.spyOn(db, "prepare");

    const result = await getLatestArtifactsWithCache(
      { DB: db as any, RUNTIME_MANIFEST_KV: kv as any } as any,
      ["capsule-1"]
    );

    expect(result.get("capsule-1")?.artifactId).toBe("cached");
    expect(dbPrepareSpy).toHaveBeenCalled();
    expect(kv.get).toHaveBeenCalledWith("feed/latest-artifact/v1/capsule-1");
  });

  it("refreshes cache when a newer active artifact appears", async () => {
    const kv = makeKv({
      "feed/latest-artifact/v1/capsule-1": JSON.stringify({ artifactId: "artifact-old", createdAt: 50 }),
    });
    const db = makeDb([
      { capsule_id: "capsule-1", id: "artifact-old", created_at: 50, status: "active" },
      { capsule_id: "capsule-1", id: "artifact-new", created_at: 200, status: "active" },
    ]);

    const result = await getLatestArtifactsWithCache(
      { DB: db as any, RUNTIME_MANIFEST_KV: kv as any } as any,
      ["capsule-1"]
    );

    expect(result.get("capsule-1")?.artifactId).toBe("artifact-new");
    expect(kv.put).toHaveBeenCalledWith(
      "feed/latest-artifact/v1/capsule-1",
      JSON.stringify({ artifactId: "artifact-new", createdAt: 200 }),
      expect.any(Object)
    );
  });
});
