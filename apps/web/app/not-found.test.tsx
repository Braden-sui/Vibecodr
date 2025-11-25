import { render, screen } from "@testing-library/react";

import NotFound from "./not-found";
import { featuredTags } from "@/lib/tags";

describe("NotFound page", () => {
  it("provides clear recovery paths back to the feed", () => {
    render(<NotFound />);

    const goToFeed = screen.getByRole("link", { name: /go to feed/i });
    expect(goToFeed).toHaveAttribute("href", "/");

    const searchInput = screen.getByLabelText(/search the feed/i);
    expect(searchInput).toHaveAttribute("name", "q");

    const searchForm = searchInput.closest("form");
    expect(searchForm).not.toBeNull();
    expect(searchForm?.getAttribute("action")).toBe("/");
    expect(searchForm).toHaveAttribute("method", "get");
  });

  it("suggests tags so users can keep exploring", () => {
    render(<NotFound />);

    featuredTags.forEach((tag) => {
      const link = screen.getByRole("link", { name: new RegExp(`#${tag}`, "i") });
      expect(link).toHaveAttribute("href", `/?tags=${encodeURIComponent(tag)}`);
    });
  });
});
