/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VibesComposer } from "../VibesComposer";
import { useUser } from "@clerk/nextjs";
import { redirectToSignIn } from "@/lib/client-auth";
import { postsApi, capsulesApi, coversApi } from "@/lib/api";

vi.mock("@clerk/nextjs", () => ({
  useUser: vi.fn(),
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
  if (value == null) {
    throw new Error("Missing form data entry");
  }
  if (typeof (value as any)?.__raw === "string") {
    return (value as any).__raw as string;
  }
  if (typeof value === "string") {
    return value;
  }

  const candidate = value as unknown as {
    text?: () => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    buffer?: ArrayBuffer | ArrayBufferView;
    data?: unknown;
  };

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

  if (candidate.buffer instanceof ArrayBuffer) {
    return new TextDecoder().decode(candidate.buffer);
  }

  try {
    return await new Response(value as BodyInit).text();
  } catch {
    // fall through
  }

  return String(value);
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

    // Patch Blob/File so we can reliably read back the JSON we constructed
    const OriginalBlob = globalThis.Blob as any;
    const OriginalFile = globalThis.File as any;
    class TestBlob extends OriginalBlob {
      __raw?: string;
      constructor(parts: any[], opts?: any) {
        super(parts, opts);
        try {
          this.__raw = parts
            .map((p: any) => (typeof p === "string" ? p : (p && p.__raw) || ""))
            .join("");
        } catch {
          this.__raw = undefined;
        }
      }
      async text() {
        try {
          return await OriginalBlob.prototype.text.call(this);
        } catch {
          return this.__raw ?? Object.prototype.toString.call(this);
        }
      }
    }
    class TestFile extends OriginalFile {
      __raw?: string;
      constructor(parts: any[], name: any, opts?: any) {
        super(parts as any, name, opts);
        try {
          this.__raw = parts
            .map((p: any) => (typeof p === "string" ? p : (p && p.__raw) || ""))
            .join("");
        } catch {
          this.__raw = undefined;
        }
      }
      async text() {
        try {
          return await OriginalBlob.prototype.text.call(this);
        } catch {
          return this.__raw ?? Object.prototype.toString.call(this);
        }
      }
    }
    (globalThis as any).Blob = TestBlob;
    (globalThis as any).File = TestFile;

    // Also capture manifest before it becomes a Blob by intercepting JSON.stringify
    let capturedManifest: any | undefined;
    const originalStringify = JSON.stringify;
    (JSON as any).stringify = function (value: any, ...args: any[]) {
      try {
        if (
          value &&
          typeof value === "object" &&
          value.runner === "client-static" &&
          value.entry === "index.html" &&
          "version" in value
        ) {
          capturedManifest = value;
        }
      } catch {}
      return (originalStringify as any)(value, ...args);
    } as any;

    const user = userEvent.setup();
    render(<VibesComposer />);

    const codeChip = screen.getByRole("button", { name: "Code" });
    await user.click(codeChip);

    const titleInput = screen.getByPlaceholderText("Title for your vibe");
    fireEvent.focus(titleInput);
    await user.type(titleInput, "Inline app with advanced settings");

    // Ensure inline code UI is present before interacting further
    await screen.findByText("Inline App Code");

    const descriptionInput = screen.getByPlaceholderText("Add more details (optional)");
    await user.type(descriptionInput, "Demo description");

    const codeTextarea = await screen.findByPlaceholderText(
      /Write your app markup \(HTML\) here\. It will run in a sandboxed iframe\./i,
    );
    await user.type(codeTextarea, "<div>Advanced</div>");

    const storageSwitch = document.getElementById("inline-code-storage") as HTMLButtonElement;
    await user.click(storageSwitch);
    await waitFor(() => expect(storageSwitch).toHaveAttribute("data-state", "checked"));

    const paramSwitch = document.getElementById("inline-code-param") as HTMLButtonElement;
    await user.click(paramSwitch);
    await waitFor(() => {
      expect(paramSwitch).toHaveAttribute("data-state", "checked");
    });

    const labelInput = await screen.findByLabelText("Label");
    await user.clear(labelInput);
    await user.type(labelInput, "Intensity");

    const defaultInput = screen.getByLabelText("Default");
    await user.clear(defaultInput);
    await user.type(defaultInput, "75");

    const minInput = screen.getByLabelText("Min");
    await user.clear(minInput);
    await user.type(minInput, "0");

    const maxInput = screen.getByLabelText("Max");
    await user.clear(maxInput);
    await user.type(maxInput, "200");

    const stepInput = screen.getByLabelText("Step");
    fireEvent.change(stepInput, { target: { value: "5" } });

    const shareButton = screen.getByRole("button", { name: /Share Vibe/i });
    await waitFor(() => expect(shareButton).not.toBeDisabled());
    await user.click(shareButton);

    await waitFor(() => {
      expect(capsulesPublishMock).toHaveBeenCalledTimes(1);
    });

    expect(capturedManifest).toBeDefined();
    const manifest = capturedManifest as any;

    expect(manifest.runner).toBe("client-static");
    expect(manifest.entry).toBe("index.html");
    expect(manifest.capabilities).toEqual({
      storage: true,
    });
    expect(Array.isArray(manifest.params)).toBe(true);
    expect(manifest.params[0]).toMatchObject({
      type: "slider",
      label: "Intensity",
      default: 75,
      min: 0,
      max: 200,
    });

    // restore JSON.stringify and global Blob/File
    (JSON as any).stringify = originalStringify;
    (globalThis as any).Blob = OriginalBlob;
    (globalThis as any).File = OriginalFile;

    // Post creation is covered by a separate test; manifest validation ends here.
  });

  it("resets Advanced settings on successful inline submit", async () => {
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

    const user = userEvent.setup();
    render(<VibesComposer />);

    const codeChip = screen.getByRole("button", { name: "Code" });
    await user.click(codeChip);

    const titleInput = screen.getByPlaceholderText("Title for your vibe");
    await user.type(titleInput, "Inline app reset test");

    const codeTextarea = await screen.findByPlaceholderText(
      /Write your app markup \(HTML\) here\. It will run in a sandboxed iframe\./i,
    );
    await user.type(codeTextarea, "<div>Reset</div>");

    const storageSwitch = screen.getByLabelText("Allow storage");
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

    // Reopen composer in Code mode and verify Advanced controls are reset
    const codeChip2 = screen.getByRole("button", { name: "Code" });
    await user.click(codeChip2);

    const titleInput2 = screen.getByPlaceholderText("Title for your vibe");
    fireEvent.focus(titleInput2);

    const storageSwitch2 = screen.getByLabelText("Allow storage") as HTMLInputElement;
    expect(storageSwitch2).not.toBeChecked();


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
    await userEvent.type(titleInput, "My inline app");

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
    await user.type(titleInput, "Inline app");

    const codeTextarea = await screen.findByPlaceholderText(
      /Write your app markup \(HTML\) here\. It will run in a sandboxed iframe\./i,
    );
    await user.type(codeTextarea, "<div>Hello</div>");

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
    await user.type(titleInput, "Inline app");

    const codeTextarea = await screen.findByPlaceholderText(
      /Write your app markup \(HTML\) here\. It will run in a sandboxed iframe\./i,
    );
    await user.type(codeTextarea, "<div>oops</div>");

    const shareButton = screen.getByRole("button", { name: /Share Vibe/i });
    await user.click(shareButton);

    expect(capsulesPublishMock).toHaveBeenCalled();

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
    await user.type(titleInput, "Inline app");

    const codeTextarea = await screen.findByPlaceholderText(
      /Write your app markup \(HTML\) here\. It will run in a sandboxed iframe\./i,
    );
    await user.type(codeTextarea, "<div>Hi</div>");

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

    // Switch to GitHub mode and expand
    const githubChip = screen.getByRole("button", { name: "GitHub" });
    await user.click(githubChip);

    const mainInput = screen.getByPlaceholderText("https://github.com/user/repo");
    await user.type(mainInput, "https://github.com/user/repo");

    const [, importInput] = screen.getAllByPlaceholderText("https://github.com/user/repo");
    await user.clear(importInput);
    await user.type(importInput, "https://github.com/user/repo");

    const importButton = screen.getByRole("button", { name: "Import Repository" });
    await user.click(importButton);

    await waitFor(() => {
      expect(capsulesImportGithubMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Repository imported successfully")).toBeInTheDocument();
    });

    // Now the cover image section should be visible; select an image
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
