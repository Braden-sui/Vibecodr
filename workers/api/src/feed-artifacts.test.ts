import { describe, it, expect } from "vitest";
import { buildLatestArtifactMap } from "./feed-artifacts";

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
