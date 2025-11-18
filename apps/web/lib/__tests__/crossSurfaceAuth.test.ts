import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import * as workerProxyRoute from "@/app/api/[...path]/route";
import { postsApi, capsulesApi } from "@/lib/api";
import { ensureUserSynced, __resetUserSyncForTests, type SyncUserPayload } from "@/lib/user-sync";

vi.mock("@clerk/nextjs/server", () => {
  return {
    auth: vi.fn(async () => ({
      userId: "user_123",
      getToken: async () => "test-worker-token",
    })),
    currentUser: vi.fn(async () => ({
      id: "user_123",
      username: "signedin",
      firstName: "Signed",
      lastName: "In",
      imageUrl: "https://avatar.cdn/test.png",
      emailAddresses: [{ emailAddress: "user@example.com" }],
    })),
  };
});

type WorkerCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
};

const WORKER_BASE = "https://worker.test";
const ORIGINAL_WORKER_BASE = process.env.WORKER_API_BASE;

describe("cross-surface auth propagation", () => {
  let originalFetch: typeof fetch;
  let workerCalls: WorkerCall[];

  beforeAll(() => {
    process.env.WORKER_API_BASE = WORKER_BASE;
  });

  afterAll(() => {
    if (ORIGINAL_WORKER_BASE) {
      process.env.WORKER_API_BASE = ORIGINAL_WORKER_BASE;
    } else {
      delete process.env.WORKER_API_BASE;
    }
  });

  beforeEach(() => {
    workerCalls = [];
    __resetUserSyncForTests();
    originalFetch = global.fetch;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const inputIsRequest = isRequest(input);
      const targetUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : inputIsRequest
              ? input.url
              : "";

      if (targetUrl.startsWith(WORKER_BASE)) {
        const headers = init?.headers ?? (inputIsRequest ? input.headers : undefined);
        const methodValue = init?.method ?? (inputIsRequest ? input.method : "GET");
        workerCalls.push({
          url: targetUrl,
          method: String(methodValue).toUpperCase(),
          headers: headersToRecord(headers),
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (targetUrl.startsWith("/api/")) {
        return dispatchCatchAll(targetUrl, init);
      }

      return originalFetch(input as any, init);
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("keeps the Clerk session from feed to studio worker calls", async () => {
    const feedResponse = await postsApi.list({ mode: "latest" });
    expect(feedResponse.ok).toBe(true);

    const userPayload: SyncUserPayload = {
      id: "user_123",
      handle: "signedin",
      name: "Signed In",
      avatarUrl: "https://avatar.cdn/test.png",
      bio: null,
      plan: undefined,
    };

    await ensureUserSynced({ user: userPayload, token: "test-worker-token" });

    const formData = new FormData();
    formData.append("manifest", new Blob(['{"name":"demo"}'], { type: "application/json" }), "manifest.json");
    const publishResponse = await capsulesApi.publish(formData);
    expect(publishResponse.ok).toBe(true);

    expect(workerCalls.length).toBeGreaterThanOrEqual(3);

    const postsCall = workerCalls.find((call) => call.url.includes("/posts"));
    const syncCall = workerCalls.find((call) => call.url.includes("/users/sync"));
    const publishCall = workerCalls.find((call) => call.url.includes("/capsules/publish"));

    expect(postsCall?.headers.authorization).toBe("Bearer test-worker-token");
    expect(syncCall?.headers.authorization).toBe("Bearer test-worker-token");
    expect(publishCall?.headers.authorization).toBe("Bearer test-worker-token");
  });
});

function headersToRecord(headers?: HeadersInit | Headers): Record<string, string> {
  if (!headers) return {};
  const normalized = headers instanceof Headers ? headers : new Headers(headers as HeadersInit);
  const record: Record<string, string> = {};
  normalized.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

async function dispatchCatchAll(url: string, init?: RequestInit) {
  const method = String(init?.method || "GET").toUpperCase();
  const absoluteUrl = url.startsWith("http") ? url : `https://pages.local${url}`;
  const headers = init?.headers ? new Headers(init.headers as HeadersInit) : undefined;
  const request = new NextRequest(absoluteUrl, {
    method,
    headers,
    body: init?.body as RequestInit["body"],
  });

  switch (method) {
    case "GET":
      return workerProxyRoute.GET(request);
    case "POST":
      return workerProxyRoute.POST(request);
    case "PUT":
      return workerProxyRoute.PUT(request);
    case "PATCH":
      return workerProxyRoute.PATCH(request);
    case "DELETE":
      return workerProxyRoute.DELETE(request);
    case "OPTIONS":
      return workerProxyRoute.OPTIONS(request);
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof input === "object" && input !== null && "method" in input && "headers" in input;
}
