import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import ShareVibePage from "../../app/(site)/post/new/page";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    getToken: vi.fn(async () => "test-token"),
  }),
}));

describe("ShareVibePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders header and core fields", () => {
    render(
      <MemoryRouter>
        <ShareVibePage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { level: 1, name: /Share a vibe/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Vibe title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Vibe text/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Share vibe/i })).toBeInTheDocument();
    expect(screen.getByText("Open Studio")).toBeInTheDocument();
    expect(screen.getByText("Import a new vibe")).toBeInTheDocument();
  });

  it("submits a post with title and description", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, id: "post123" }),
    });
    (global as any).fetch = fetchMock;

    render(
      <MemoryRouter>
        <ShareVibePage />
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/Vibe title/i), "My demo vibe");
    await user.type(screen.getByLabelText(/Vibe text/i), "This is a test vibe.");

    const submitButton = screen.getByRole("button", { name: /Share vibe/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      const [url, init] = fetchMock.mock.calls[0];
      expect(typeof url).toBe("string");
      expect(url).toContain("/posts");
      expect(init).toEqual(
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
          body: expect.stringContaining("My demo vibe"),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/Your vibe has been shared/i)).toBeInTheDocument();
    });
  });
});
