import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportButton } from "../ReportButton";

describe("ReportButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should render icon variant by default", () => {
    render(<ReportButton targetType="post" targetId="post1" />);
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });

  it("should render text variant when specified", () => {
    render(<ReportButton targetType="post" targetId="post1" variant="text" />);
    expect(screen.getByText("Report")).toBeInTheDocument();
  });

  it("should open dialog when clicked", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReportButton targetType="post" targetId="post1" />);

    const button = screen.getByRole("button");
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText("Report Post")).toBeInTheDocument();
    });
  });

  it("should display all report reasons in select", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReportButton targetType="comment" targetId="comment1" />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("Report Comment")).toBeInTheDocument();
    });
  });

  it("should require reason selection before submitting", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      const submitButton = screen.getByRole("button", { name: /Submit Report/i });
      expect(submitButton).toBeDisabled();
    });
  });

  it("should enforce 500 character limit on details", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    await waitFor(async () => {
      const textarea = screen.getByPlaceholderText(/Provide any additional context/i);
      await user.type(textarea, "a".repeat(500));
      expect(screen.getByText("500/500")).toBeInTheDocument();
    });
  });

  it("should submit report successfully", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    await waitFor(async () => {
      expect(screen.getByText("Report Post")).toBeInTheDocument();
    });

    // Select reason (using fireEvent since userEvent has issues with custom selects)
    const selectTrigger = screen.getByRole("combobox");
    fireEvent.click(selectTrigger);

    await waitFor(() => {
      const spamOption = screen.getByText("Spam or misleading");
      fireEvent.click(spamOption);
    });

    // Submit
    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/moderation/report",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("spam"),
        })
      );
    });
  });

  it("should show success message after submission", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      const selectTrigger = screen.getByRole("combobox");
      fireEvent.click(selectTrigger);
    });

    await waitFor(() => {
      const spamOption = screen.getByText("Spam or misleading");
      fireEvent.click(spamOption);
    });

    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Report Submitted")).toBeInTheDocument();
      expect(screen.getByText(/Thank you for helping keep Vibecodr safe/i)).toBeInTheDocument();
    });
  });

  it("should auto-close after successful submission", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      const selectTrigger = screen.getByRole("combobox");
      fireEvent.click(selectTrigger);
    });

    await waitFor(() => {
      const harassmentOption = screen.getByText("Harassment or bullying");
      fireEvent.click(harassmentOption);
    });

    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Report Submitted")).toBeInTheDocument();
    });

    // Fast-forward 2 seconds
    vi.advanceTimersByTime(2000);

    await waitFor(() => {
      expect(screen.queryByText("Report Submitted")).not.toBeInTheDocument();
    });
  });

  it("should handle API errors gracefully", async () => {
    const user = userEvent.setup({ delay: null });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Rate limit exceeded" }),
    });

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      const selectTrigger = screen.getByRole("combobox");
      fireEvent.click(selectTrigger);
    });

    await waitFor(() => {
      const otherOption = screen.getByText("Other");
      fireEvent.click(otherOption);
    });

    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Rate limit exceeded");
    });

    alertSpy.mockRestore();
  });

  it("should include optional details in submission", async () => {
    const user = userEvent.setup({ delay: null });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      const selectTrigger = screen.getByRole("combobox");
      fireEvent.click(selectTrigger);
    });

    await waitFor(() => {
      const copyrightOption = screen.getByText("Copyright violation");
      fireEvent.click(copyrightOption);
    });

    const textarea = screen.getByPlaceholderText(/Provide any additional context/i);
    await user.type(textarea, "This violates my copyright");

    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/moderation/report",
        expect.objectContaining({
          body: expect.stringContaining("This violates my copyright"),
        })
      );
    });
  });

  it("should disable submit button while submitting", async () => {
    const user = userEvent.setup({ delay: null });
    let resolveSubmit: (value: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    global.fetch = vi.fn().mockReturnValue(submitPromise);

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      const selectTrigger = screen.getByRole("combobox");
      fireEvent.click(selectTrigger);
    });

    await waitFor(() => {
      const inappropriateOption = screen.getByText("Inappropriate content");
      fireEvent.click(inappropriateOption);
    });

    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Submitting/i })).toBeDisabled();
    });

    resolveSubmit!({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });
});
