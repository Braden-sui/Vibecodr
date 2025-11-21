import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ShareVibePage from "../../app/(site)/post/new/page";

describe("ShareVibePage", () => {
  it("renders header and the unified composer", async () => {
    render(
      <MemoryRouter>
        <ShareVibePage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { level: 1, name: /Share a vibe/i })).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/What's your vibe/i);
    expect(input).toBeInTheDocument();

    fireEvent.focus(input);

    expect(screen.getByRole("button", { name: /Share Vibe/i })).toBeInTheDocument();
  });
});
