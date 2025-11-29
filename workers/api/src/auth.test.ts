import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetAuthStateForTests, verifyAuth } from "./auth";
import type { Env } from "./types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const TEST_ISSUER = "https://clerk.example.com";
const TEST_AUDIENCE = "worker-api";

type TestEnv = Env;

describe("verifyAuth", () => {
  let keyPair: CryptoKeyPair;
  type PublicJwk = JsonWebKey & { kid?: string };
  let publicJwk: PublicJwk;
  let env: TestEnv;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"]
    );
    publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    publicJwk.kid = "test-key";
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    __resetAuthStateForTests();
    env = createEnv();
    mockJwksResponse();
  });

  it("accepts valid worker tokens when aud and azp match", async () => {
    const token = await createSignedToken();
    const request = new Request("https://example.com/api", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const result = await verifyAuth(request, env);

    expect(result).not.toBeNull();
    expect(result?.userId).toBe("user_123");
    expect(result?.claims.azp).toBe(TEST_AUDIENCE);
  });

  it("accepts valid worker tokens without azp when aud matches a single allowed audience", async () => {
    const token = await createSignedToken({ azp: undefined });
    const request = new Request("https://example.com/api", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const result = await verifyAuth(request, env);

    expect(result).not.toBeNull();
    expect(result?.userId).toBe("user_123");
    expect(result?.claims.azp).toBeUndefined();
  });

  it("rejects multi-audience tokens without azp", async () => {
    const token = await createSignedToken({ aud: [TEST_AUDIENCE, "second"], azp: undefined });
    const request = new Request("https://example.com/api", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await verifyAuth(request, env);

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("rejects tampered tokens and logs a typed error", async () => {
    const token = await createSignedToken();
    const tamperedToken = tamperPayload(token, { sub: "user_bad" });
    const request = new Request("https://example.com/api", {
      headers: { Authorization: `Bearer ${tamperedToken}` },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await verifyAuth(request, env);

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    const messages = consoleSpy.mock.calls.map((call) => String(call[0]));
    expect(messages.some((msg) => msg.includes("E-VIBECODR-0006"))).toBe(true);

    consoleSpy.mockRestore();
  });

  function mockJwksResponse() {
    const responseBody = JSON.stringify({ keys: [{ ...publicJwk }] });
    globalThis.fetch = vi.fn(async () =>
      new Response(responseBody, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
        },
      })
    ) as typeof fetch;
  }

  function createEnv(overrides: Partial<TestEnv> = {}): TestEnv {
    return {
      DB: {} as D1Database,
      R2: {} as R2Bucket,
      RUNTIME_MANIFEST_KV: undefined,
      ALLOWLIST_HOSTS: "[]",
      CLERK_JWT_ISSUER: TEST_ISSUER,
      CLERK_JWT_AUDIENCE: TEST_AUDIENCE,
      BUILD_COORDINATOR_DURABLE: {} as DurableObjectNamespace,
      ARTIFACT_COMPILER_DURABLE: {} as DurableObjectNamespace,
      RATE_LIMIT_SHARD: {} as DurableObjectNamespace,
      vibecodr_analytics_engine: {} as AnalyticsEngineDataset,
      RUNTIME_ARTIFACTS_ENABLED: undefined,
      ...overrides,
    };
  }

  async function createSignedToken(overrides: Record<string, unknown> = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: TEST_ISSUER,
      sub: "user_123",
      sid: "sess_123",
      aud: TEST_AUDIENCE,
      azp: TEST_AUDIENCE,
      exp: now + 600,
      iat: now - 60,
      ...overrides,
    };
    const header = { alg: "RS256", typ: "JWT", kid: publicJwk.kid };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      keyPair.privateKey,
      textEncoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
    const encodedSignature = base64UrlEncode(signature);
    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  function tamperPayload(token: string, updates: Record<string, unknown>): string {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    const payload = decodeJwtSection(encodedPayload);
    const mutatedPayload = { ...payload, ...updates };
    const tamperedPayload = base64UrlEncode(JSON.stringify(mutatedPayload));
    return `${encodedHeader}.${tamperedPayload}.${encodedSignature}`;
  }

  function decodeJwtSection(segment: string): Record<string, unknown> {
    const bytes = base64UrlDecode(segment);
    return JSON.parse(textDecoder.decode(bytes)) as Record<string, unknown>;
  }

  function base64UrlEncode(data: string | ArrayBuffer): string {
    const bytes = typeof data === "string" ? textEncoder.encode(data) : new Uint8Array(data);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlDecode(segment: string): Uint8Array {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (normalized.length % 4 || 4)) % 4;
    const padded = normalized + "=".repeat(padLength);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
});
