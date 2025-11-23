import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VibesComposer } from "../VibesComposer";
import { useUser } from "@clerk/clerk-react";
import { redirectToSignIn } from "@/lib/client-auth";
import { postsApi, capsulesApi, coversApi } from "@/lib/api";

vi.mock("@clerk/clerk-react", () => ({
  useUser: vi.fn(),
  useAuth: () => ({
    getToken: vi.fn(async () => "test-token"),
  }),
}));

vi.mock("@/lib/client-auth", () => ({
  redirectToSignIn: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  postsApi: {
    create: vi.fn(),
  },
  capsulesApi: {
    publish: vi.fn(),
    importGithub: vi.fn(),
  },
  coversApi: {
    upload: vi.fn(),
  },
}));

const postsApiCreateMock = postsApi.create as any;
const capsulesPublishMock = capsulesApi.publish as any;
const capsulesImportGithubMock = capsulesApi.importGithub as any;
const coversUploadMock = coversApi.upload as any;

async function readFormDataEntry(value: FormDataEntryValue | null): Promise<string> {
  if (value == null) throw new Error("Missing form data entry");

  if (typeof value === "string") return value;

  const candidate = value as any;
  if (typeof candidate.text === "function") {
    return candidate.text();
  }
  if (typeof candidate.arrayBuffer === "function") {
    const buf = await candidate.arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return await new Response(value).text();
  }

  try {
    return await new Response(value as BodyInit).text();
  } catch {
    return String(value);
  }
}

describe("VibesComposer inline code mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useUser as unknown as Mock).mockReturnValue({
      user: {
        id: "user1",
        username: "testuser",
        fullName: "Test User",
        imageUrl: "https://example.com/avatar.png",
      },
      isSignedIn: true,
    });
  });

  it("includes capabilities and params from Advanced inline settings in manifest", async () => {
    let capturedManifest: any;
    const originalStringify = JSON.stringify;
    try {
      (JSON as any).stringify = function (value: any, ...args: any[]) {
        try {
          if (
            value &&
            typeof value === "object" &&
            value.runner === "webcontainer" &&
            value.entry === "entry.tsx" &&
            value.version === "1.0"
          ) {
            capturedManifest = value;
          }
        } catch {
          // ignore
        }
        return (originalStringify as any)(value, ...args);
      } as any;

      capsulesPublishMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, capsuleId: "caps123" }),
      } as any);

      postsApiCreateMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: "post123" }),
      } as any);

      const user = userEvent.setup();
      render(<VibesComposer />);

      const codeChip = screen.getByRole("button", { name: "Code" });
      await user.click(codeChip);

      const titleInput = screen.getByPlaceholderText("Title for your vibe");
      fireEvent.focus(titleInput);
      fireEvent.change(titleInput, { target: { value: "Inline app with advanced settings" } });

      const descriptionInput = screen.getByPlaceholderText("Add more details (optional)");
      fireEvent.change(descriptionInput, { target: { value: "Demo description" } });

      const codeTextarea = await screen.findByPlaceholderText(
        /Write your app code here\. HTML stays client-static/i
      );
      fireEvent.change(codeTextarea, { target: { value: "<div>Advanced</div>" } });

      const storageSwitch = document.getElementById("inline-code-storage") as HTMLButtonElement;
      await user.click(storageSwitch);

      const paramSwitch = document.getElementById("inline-code-param") as HTMLButtonElement;
      await user.click(paramSwitch);

      const labelInput = await screen.findByLabelText("Label");
      fireEvent.change(labelInput, { target: { value: "Intensity" } });

      const defaultInput = screen.getByLabelText("Default");
      fireEvent.change(defaultInput, { target: { value: "75" } });

      const minInput = screen.getByLabelText("Min");
      fireEvent.change(minInput, { target: { value: "0" } });

      const maxInput = screen.getByLabelText("Max");
      fireEvent.change(maxInput, { target: { value: "200" } });

      const stepInput = screen.getByLabelText("Step");
      fireEvent.change(stepInput, { target: { value: "5" } });

      const shareButton = screen.getByRole("button", { name: /Share Vibe/i });
      await waitFor(() => expect(shareButton).not.toBeDisabled());
      await user.click(shareButton);

      await waitFor(() => {
        expect(capsulesPublishMock).toHaveBeenCalledTimes(1);
        expect(postsApiCreateMock).toHaveBeenCalledTimes(1);
      });

      expect(capturedManifest.runner).toBe("webcontainer");
      expect(capturedManifest.entry).toBe("entry.tsx");
      expect(capturedManifest.capabilities).toEqual({ storage: true });
      expect(Array.isArray(capturedManifest.params)).toBe(true);
      expect(capturedManifest.params[0]).toMatchObject({
        name: "intensity",
        type: "slider",
        label: "Intensity",
        default: 75,
        min: 0,
        max: 200,
        step: 5,
      });
    } finally {
      (JSON as any).stringify = originalStringify;
    }
  });

  it("resets Advanced settings on successful inline submit", async () => {
    capsulesPublishMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, capsuleId: "caps123" }),
    } as any);

    postsApiCreateMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "post123" }),
    } as any);

    const user = userEvent.setup();
    render(<VibesComposer />);

    const codeChip = screen.getByRole("button", { name: "Code" });
    await user.click(codeChip);

    const titleInput = screen.getByPlaceholderText("Title for your vibe");
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "Inline app reset test" } });

    const codeTextarea = await screen.findByPlaceholderText(
      /Write your app code here\. HTML stays client-static/i
    );
    fireEvent.change(codeTextarea, { target: { value: "<div>Reset</div>" } });

    const storageSwitch = document.getElementById("inline-code-storage") as HTMLButtonElement;
    await user.click(storageSwitch);

    const paramSwitch = document.getElementById("inline-code-param") as HTMLButtonElement;
    await user.click(paramSwitch);

    const labelInput = await screen.findByLabelText("Label");
    await user.clear(labelInput);
    await user.type(labelInput, "Speed");

    const shareButton = screen.getByRole("button", { name: /Share Vibe/i });
    await user.click(shareButton);

    await waitFor(() => {
      expect(postsApiCreateMock).toHaveBeenCalledTimes(1);
    });

    const codeChip2 = screen.getByRole("button", { name: "Code" });
    await user.click(codeChip2);

    const reopenTitle = screen.getByPlaceholderText("Title for your vibe");
    fireEvent.focus(reopenTitle);
    await screen.findByText("Inline App Code");

    const storageSwitch2 = document.getElementById("inline-code-storage") as HTMLButtonElement;
    expect(storageSwitch2).toHaveAttribute("data-state", "unchecked");

    const paramSwitch2 = document.getElementById("inline-code-param") as HTMLButtonElement;
    expect(paramSwitch2).toHaveAttribute("data-state", "unchecked");
  });

  it("shows inline code editor when Code mode is selected", async () => {
    render(<VibesComposer />);

    const codeChip = screen.getByRole("button", { name: "Code" });
    await userEvent.click(codeChip);

    const titleInput = screen.getByPlaceholderText("Title for your vibe");
    fireEvent.focus(titleInput);

    await waitFor(() => {
      expect(screen.getByText("Inline App Code")).toBeInTheDocument();
    });
  });

  it("validates that code is required before submit", async () => {
    render(<VibesComposer />);

    const codeChip = screen.getByRole("button", { name: "Code" });
    await userEvent.click(codeChip);

    const titleInput = screen.getByPlaceholderText("Title for your vibe");
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "My inline app" } });

    const shareButton = screen.getByRole("button", { name: /Share Vibe/i });
    await userEvent.click(shareButton);

    expect(await screen.findByText("Please add some code for your app")).toBeInTheDocument();
    expect(capsulesPublishMock).not.toHaveBeenCalled();
    expect(postsApiCreateMock).not.toHaveBeenCalled();
  });

  it("publishes inline code capsule and creates an app post", async () => {
    postsApiCreateMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "post123" }),
    } as any);

    capsulesPublishMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, capsuleId: "caps123" }),
    } as any);

    const onPostCreated = vi.fn();
    const user = userEvent.setup();
    render(<VibesComposer onPostCreated={onPostCreated} />);

    const codeChip = screen.getByRole("button", { name: "Code" });
    await user.click(codeChip);

    const titleInput = screen.getByPlaceholderText("Title for your vibe");
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "Inline app" } });

    const codeTextarea = await screen.findByPlaceholderText(
      /Write your app code here\. HTML stays client-static/i
    );
    fireEvent.change(codeTextarea, { target: { value: "<div>Hello</div>" } });

    const shareButton = screen.getByRole("button", { name: /Share Vibe/i });
    await user.click(shareButton);

    await waitFor(() => {
      expect(capsulesPublishMock).toHaveBeenCalledTimes(1);
      expect(postsApiCreateMock).toHaveBeenCalledTimes(1);
    });

    expect(postsApiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Inline app",
        type: "app",
        capsuleId: "caps123",
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      })
    );

    await waitFor(() => {
      expect(onPostCreated).toHaveBeenCalledTimes(1);
    });

    const optimisticPost = onPostCreated.mock.calls[0][0];
    expect(optimisticPost.id).toBe("post123");
    expect(optimisticPost.type).toBe("app");
    expect(optimisticPost.capsule?.id).toBe("caps123");
  });

  it("shows error when inline code publish fails", async () => {
    capsulesPublishMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: "Bad code" }),
    } as any);

    const user = userEvent.setup();
    render(<VibesComposer />);

    const codeChip = screen.getByRole("button", { name: "Code" });
    await user.click(codeChip);

    const titleInput = screen.getByPlaceholderText("Title for your vibe");
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "Inline app" } });

    const codeTextarea = await screen.findByPlaceholderText(
      /Write your app code here\. HTML stays client-static/i
    );
    fireEvent.change(codeTextarea, { target: { value: "<div>oops</div>" } });

    const shareButton = screen.getByRole("button", { name: /Share Vibe/i });
    await user.click(shareButton);

    await waitFor(() => {
      expect(capsulesPublishMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("Bad code")).toBeInTheDocument();
    });

    expect(postsApiCreateMock).not.toHaveBeenCalled();
  });

  it("redirects to sign in when inline publish returns 401", async () => {
    capsulesPublishMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as any);

    const user = userEvent.setup();
    render(<VibesComposer />);

    const codeChip = screen.getByRole("button", { name: "Code" });
    await user.click(codeChip);

    const titleInput = screen.getByPlaceholderText("Title for your vibe");
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "Inline app" } });

    const codeTextarea = await screen.findByPlaceholderText(
      /Write your app code here\. HTML stays client-static/i
    );
    fireEvent.change(codeTextarea, { target: { value: "<div>Hi</div>" } });

    const shareButton = screen.getByRole("button", { name: /Share Vibe/i });
    await user.click(shareButton);

    await waitFor(() => {
      expect(redirectToSignIn).toHaveBeenCalled();
    });

    expect(postsApiCreateMock).not.toHaveBeenCalled();
  });

  it("uploads cover image for imported capsule and passes coverKey to post create", async () => {
    postsApiCreateMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "post123" }),
    } as any);

    capsulesImportGithubMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, capsuleId: "caps123", manifest: { title: "Imported App" } }),
    } as any);

    coversUploadMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, key: "covers/user1/cover.png" }),
    } as any);

    const user = userEvent.setup();
    const { container } = render(<VibesComposer />);

    const githubChip = screen.getByRole("button", { name: "GitHub" });
    await user.click(githubChip);

    const [mainInput] = screen.getAllByPlaceholderText("https://github.com/user/repo");
    fireEvent.focus(mainInput);
    fireEvent.change(mainInput, { target: { value: "https://github.com/user/repo" } });

    const [, importInput] = screen.getAllByPlaceholderText("https://github.com/user/repo");
    fireEvent.change(importInput, { target: { value: "" } });
    fireEvent.focus(importInput);
    fireEvent.change(importInput, { target: { value: "https://github.com/user/repo" } });

    const importButton = screen.getByRole("button", { name: "Import Repository" });
    await user.click(importButton);

    await waitFor(() => {
      expect(capsulesImportGithubMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Repository imported successfully")).toBeInTheDocument();
    });

    const fileInput = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    const file = new File(["dummy"], "cover.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(coversUploadMock).toHaveBeenCalledTimes(1);
    });

    const shareButton = screen.getByRole("button", { name: /Share Vibe/i });
    await user.click(shareButton);

    await waitFor(() => {
      expect(postsApiCreateMock).toHaveBeenCalledTimes(1);
    });

    const createArgs = postsApiCreateMock.mock.calls[0][0] as any;
    expect(createArgs.capsuleId).toBe("caps123");
    expect(createArgs.coverKey).toBe("covers/user1/cover.png");
  });
});
