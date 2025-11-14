import { describe, it, expect } from "vitest";
import { ApiFeedResponseSchema } from "./contracts";

describe("ApiFeedResponseSchema", () => {
  it("accepts a minimal valid feed payload", () => {
    const payload = {
      posts: [
        {
          id: "post_demo_app",
          type: "app",
          title: "Demo Post",
          description: "Seed demo post",
          tags: ["demo"],
          author: {
            id: "user_demo",
            handle: "demo",
            name: "Demo User",
            avatarUrl: null,
            bio: null,
            followersCount: 0,
            runsCount: 0,
            remixesCount: 0,
            isFeatured: false,
            plan: "free",
          },
          capsule: {
            id: "capsule_demo",
          },
          createdAt: Date.now() / 1000,
          stats: {
            runs: 1,
            comments: 0,
            likes: 0,
            remixes: 0,
          },
        },
      ],
      mode: "latest",
      limit: 20,
      offset: 0,
    };

    expect(() => ApiFeedResponseSchema.parse(payload)).not.toThrow();
  });
});
