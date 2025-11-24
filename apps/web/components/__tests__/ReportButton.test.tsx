import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react-dom/test-utils";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api", () => ({
  moderationApi: {
    report: vi.fn(),
  },
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    getToken: vi.fn(async () => "test-token"),
  }),
}));

import { moderationApi } from "@/lib/api";
import { ReportButton } from "../ReportButton";

declare global {
  // eslint-disable-next-line no-var
  var PointerEvent: typeof window.PointerEvent;
}

if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType?: string;
    isPrimary?: boolean;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof window.PointerEvent;
}

const elementProto = Element.prototype as Element & {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

if (!elementProto.hasPointerCapture) {
  elementProto.hasPointerCapture = () => false;
}
if (!elementProto.setPointerCapture) {
  elementProto.setPointerCapture = () => {};
}
if (!elementProto.releasePointerCapture) {
  elementProto.releasePointerCapture = () => {};
}

const reportMock = moderationApi.report as any;

describe("ReportButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    reportMock.mockReset();
    reportMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
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

    const textarea = await screen.findByPlaceholderText(/Provide any additional context/i);
    fireEvent.change(textarea, { target: { value: "a".repeat(600) } });
    expect(textarea).toHaveValue("a".repeat(500));
    expect(screen.getByText("500/500")).toBeInTheDocument();
  });

  it("should submit report successfully", async () => {
    const user = userEvent.setup({ delay: null });
    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    await screen.findByText("Report Post");

    // Select reason
    const selectTrigger = screen.getByRole("combobox");
    await user.click(selectTrigger);

    const spamOption = await screen.findByText("Spam or misleading");
    await user.click(spamOption);

    // Submit
    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(reportMock).toHaveBeenCalledWith(
        {
          targetType: "post",
          targetId: "post1",
          reason: "spam",
          details: undefined,
        },
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        })
      );
    });
  });

  it("should show success message after submission", async () => {
    const user = userEvent.setup({ delay: null });

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    const selectTrigger = await screen.findByRole("combobox");
    await user.click(selectTrigger);

    const spamOption = await screen.findByText("Spam or misleading");
    await user.click(spamOption);

    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Report Submitted")).toBeInTheDocument();
      expect(screen.getByText(/Thank you for helping keep Vibecodr safe/i)).toBeInTheDocument();
    });
  });

  it("should auto-close after successful submission", async () => {
    const user = userEvent.setup({ delay: null });

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    const selectTrigger = await screen.findByRole("combobox");
    await user.click(selectTrigger);

    const harassmentOption = await screen.findByText("Harassment or bullying");
    await user.click(harassmentOption);

    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Report Submitted")).toBeInTheDocument();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2100));
    });

    expect(screen.queryByText("Report Submitted")).not.toBeInTheDocument();
  });

  it("should handle API errors gracefully", async () => {
    const user = userEvent.setup({ delay: null });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "Rate limit exceeded" }),
    });

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    const selectTrigger = await screen.findByRole("combobox");
    await user.click(selectTrigger);

    const otherOption = await screen.findByText("Other");
    await user.click(otherOption);

    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to submit report:",
        expect.any(Error)
      );
    });

    consoleSpy.mockRestore();
  });

  it("should include optional details in submission", async () => {
    const user = userEvent.setup({ delay: null });
    let capturedPayload: Record<string, unknown> | null = null;
    let capturedInit: RequestInit | null = null;
    reportMock.mockImplementationOnce(async (payload: Record<string, unknown>, init?: RequestInit) => {
      capturedPayload = payload;
      capturedInit = init ?? null;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    });

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    const selectTrigger = await screen.findByRole("combobox");
    await user.click(selectTrigger);

    const copyrightOption = await screen.findByText("Copyright violation");
    await user.click(copyrightOption);

    const textarea = screen.getByPlaceholderText(/Provide any additional context/i);
    fireEvent.change(textarea, { target: { value: "This violates my copyright" } });

    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(reportMock).toHaveBeenCalledTimes(1);
      expect(capturedPayload).toMatchObject({
        targetType: "post",
        targetId: "post1",
        reason: "copyright",
        details: "This violates my copyright",
      });
      expect(capturedInit?.headers).toMatchObject({
        Authorization: "Bearer test-token",
      });
    });
  });

  it("should disable submit button while submitting", async () => {
    const user = userEvent.setup({ delay: null });
    let resolveSubmit: (value: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    reportMock.mockReturnValueOnce(submitPromise as any);

    render(<ReportButton targetType="post" targetId="post1" />);

    await user.click(screen.getByRole("button"));

    const selectTrigger = await screen.findByRole("combobox");
    await user.click(selectTrigger);

    const inappropriateOption = await screen.findByText("Inappropriate content");
    await user.click(inappropriateOption);

    const submitButton = screen.getByRole("button", { name: /Submit Report/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Submitting/i })).toBeDisabled();
    });

    await act(async () => {
      resolveSubmit!({
        ok: true,
        json: async () => ({ ok: true }),
      });
    });
  });
});
