import { describe, expect, it, vi } from "vitest";
import { mapApiFeedPostToFeedPost } from "./api";
import { safeParseCapsuleManifest } from "./manifest";
import { createDefaultManifest, type Manifest } from "@vibecodr/shared/manifest";
import type { ApiFeedPost } from "@vibecodr/shared";

describe("safeParseCapsuleManifest", () => {
  it("returns a typed manifest when payload matches the schema", () => {
    const manifest: Manifest = {
      ...createDefaultManifest(),
      title: "Test App",
    };
    const result = safeParseCapsuleManifest({ ...manifest, id: "caps-1" }, { source: "test" });

    expect(result.manifest).toMatchObject({
      runner: "client-static",
      entry: "index.html",
      title: "Test App",
    });
    expect(result.errors).toBeUndefined();
  });

  it("rejects invalid manifests with issues", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = safeParseCapsuleManifest({ runner: "client-static" }, { source: "test", capsuleId: "caps-1" });

    expect(result.manifest).toBeNull();
    expect(result.errors && result.errors.length).toBeGreaterThan(0);
    errorSpy.mockRestore();
  });
});

describe("mapApiFeedPostToFeedPost", () => {
  const baseApiPost: ApiFeedPost = {
    id: "post-1",
    type: "app",
    title: "Hello",
    description: null,
    tags: [],
    author: {
      id: "author-1",
      handle: "dev",
      name: null,
      avatarUrl: null,
      bio: null,
      followersCount: 0,
      runsCount: 0,
      remixesCount: 0,
      isFeatured: false,
    },
    capsule: null,
    coverKey: null,
    createdAt: 1,
    stats: { runs: 0, comments: 0, likes: 0, remixes: 0 },
  };

  it("drops unsafe capsule payloads instead of trusting malformed manifests", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const malformed: ApiFeedPost = {
      ...baseApiPost,
      capsule: { id: "caps-malformed", runner: "client-static" },
    };
    const mapped = mapApiFeedPostToFeedPost(malformed);

    expect(mapped.capsule).toEqual({ id: "caps-malformed", artifactId: null });
    errorSpy.mockRestore();
  });

  it("keeps validated manifest fields when schema matches", () => {
    const manifest = createDefaultManifest();
    const valid: ApiFeedPost = {
      ...baseApiPost,
      capsule: { id: "caps-valid", ...manifest, artifactId: "art-1" },
    };
    const mapped = mapApiFeedPostToFeedPost(valid);

    expect(mapped.capsule?.runner).toBe("client-static");
    expect(mapped.capsule?.params).toEqual([]);
    expect(mapped.capsule?.artifactId).toBe("art-1");
  });
});
