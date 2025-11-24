/// <reference types="vitest" />
import { describe, it, expect } from "vitest";
import { computePostDrift, computeUserDrift } from "./reconcileCounters";

describe("computePostDrift", () => {
  it("detects mismatched counters and preserves matches", () => {
    const rows = [
      { id: "p1", likes_count: 1, comments_count: 2, runs_count: 0 },
      { id: "p2", likes_count: 0, comments_count: 0, runs_count: 0 },
    ];
    const likes = new Map([
      ["p1", 2],
      ["p2", 0],
    ]);
    const comments = new Map([
      ["p1", 2],
      ["p2", 5],
    ]);
    const runs = new Map([
      ["p1", 0],
      ["p2", 3],
    ]);

    const drift = computePostDrift(rows, likes, comments, runs);

    expect(drift).toEqual([
      { id: "p1", likes: 2 },
      { id: "p2", comments: 5, runs: 3 },
    ]);
  });

  it("treats missing aggregates as zero", () => {
    const rows = [{ id: "p1", likes_count: 5, comments_count: 5, runs_count: 5 }];
    const drift = computePostDrift(rows, new Map(), new Map(), new Map());
    expect(drift).toEqual([{ id: "p1", likes: 0, comments: 0, runs: 0 }]);
  });
});

describe("computeUserDrift", () => {
  it("detects deltas across all counters", () => {
    const rows = [
      { id: "u1", followers_count: 10, following_count: 1, posts_count: 3, runs_count: 7, remixes_count: 0 },
      { id: "u2", followers_count: 0, following_count: 0, posts_count: 0, runs_count: 0, remixes_count: 0 },
    ];
    const followers = new Map([
      ["u1", 9],
      ["u2", 1],
    ]);
    const following = new Map([
      ["u1", 2],
      ["u2", 0],
    ]);
    const posts = new Map([
      ["u1", 4],
      ["u2", 0],
    ]);
    const runs = new Map([
      ["u1", 7],
      ["u2", 5],
    ]);
    const remixes = new Map([
      ["u1", 1],
      ["u2", 0],
    ]);

    const drift = computeUserDrift(rows, followers, following, posts, runs, remixes);

    expect(drift).toEqual([
      { id: "u1", followers: 9, following: 2, posts: 4, remixes: 1 },
      { id: "u2", followers: 1, runs: 5 },
    ]);
  });

  it("ignores users with matching counters", () => {
    const rows = [{ id: "u1", followers_count: 2, following_count: 1, posts_count: 0, runs_count: 0, remixes_count: 0 }];
    const followers = new Map([["u1", 2]]);
    const following = new Map([["u1", 1]]);
    const posts = new Map([["u1", 0]]);
    const runs = new Map([["u1", 0]]);
    const remixes = new Map([["u1", 0]]);

    const drift = computeUserDrift(rows, followers, following, posts, runs, remixes);
    expect(drift).toEqual([]);
  });
});
