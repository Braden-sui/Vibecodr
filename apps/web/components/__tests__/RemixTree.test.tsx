import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import RemixTree from "../RemixTree";
import type { RemixTreeResponse } from "@/lib/api";

const sampleTree: RemixTreeResponse = {
  rootCapsuleId: "root",
  requestedCapsuleId: "child-b",
  directParentId: "child-a",
  truncated: false,
  nodes: [
    {
      capsuleId: "root",
      postId: "post-root",
      title: "Bouncing Ball",
      description: "Base vibe",
      authorId: "u1",
      authorHandle: "creator",
      authorDisplayName: "Creator",
      createdAt: 1,
      parentId: null,
      children: ["child-a"],
      depth: 0,
      remixCount: 1,
    },
    {
      capsuleId: "child-a",
      postId: "post-a",
      title: "Neon Ball",
      description: "Glow effect",
      authorId: "u2",
      authorHandle: "maria",
      authorDisplayName: "Maria",
      createdAt: 2,
      parentId: "root",
      children: ["child-b"],
      depth: 1,
      remixCount: 1,
    },
    {
      capsuleId: "child-b",
      postId: "post-b",
      title: "Disco Ball",
      description: "Music sync",
      authorId: "u3",
      authorHandle: "jake",
      authorDisplayName: "Jake",
      createdAt: 3,
      parentId: "child-a",
      children: [],
      depth: 2,
      remixCount: 0,
      isRequested: true,
    },
  ],
};

describe("RemixTree", () => {
  it("renders lineage with parent and children", () => {
    render(
      <MemoryRouter>
        <RemixTree tree={sampleTree} />
      </MemoryRouter>
    );

    expect(screen.getByText("Bouncing Ball")).toBeInTheDocument();
    expect(screen.getByText("Neon Ball")).toBeInTheDocument();
    expect(screen.getByText("Disco Ball")).toBeInTheDocument();
    expect(screen.getByText(/View parent chain/i)).toHaveAttribute("href", "/vibe/child-a/remixes");
    expect(screen.getByText(/Open in player/i)).toHaveAttribute("href", "/player/post-b");
  });

  it("shows truncation notice when lineage is truncated", () => {
    const truncatedTree = { ...sampleTree, truncated: true };
    render(
      <MemoryRouter>
        <RemixTree tree={truncatedTree} />
      </MemoryRouter>
    );

    expect(screen.getByText(/Lineage is truncated/i)).toBeInTheDocument();
  });
});
