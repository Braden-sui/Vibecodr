import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Env } from "./types";
import type { AuthenticatedUser } from "./auth";
import { getCapsule, verifyCapsule } from "./handlers/capsules";
import { verifyAuth, isModeratorOrAdmin } from "./auth";
import { verifyCapsuleIntegrity, getCapsuleMetadata } from "./storage/r2";
import { checkPublicRateLimit } from "./rateLimit";

vi.mock("./auth", () => ({
  verifyAuth: vi.fn(),
  isModeratorOrAdmin: vi.fn(),
  requireAuth: (handler: any) => handler,
  requireUser: (handler: any) => handler,
  requireAdmin: (handler: any) => handler,
}));

vi.mock("./storage/r2", () => ({
  verifyCapsuleIntegrity: vi.fn(async () => true),
  getCapsuleMetadata: vi.fn(async () => ({ size: 0 })),
}));

vi.mock("./rateLimit", () => ({
  getClientIp: () => "127.0.0.1",
  checkPublicRateLimit: vi.fn(async () => ({ allowed: true })),
}));

const verifyAuthMock = vi.mocked(verifyAuth);
const isModeratorOrAdminMock = vi.mocked(isModeratorOrAdmin);
const verifyCapsuleIntegrityMock = vi.mocked(verifyCapsuleIntegrity);
const getCapsuleMetadataMock = vi.mocked(getCapsuleMetadata);
const checkPublicRateLimitMock = vi.mocked(checkPublicRateLimit);

type CapsuleRow = {
  id: string;
  owner_id: string;
  manifest_json: string;
  hash: string;
  quarantined?: number | null;
  quarantine_reason?: string | null;
  quarantined_at?: number | null;
  created_at?: number | null;
};

const baseManifest = {
  version: "1.0",
  runner: "client-static",
  entry: "index.html",
};

function createEnv(overrides?: Partial<CapsuleRow>): Env {
  const capsule: CapsuleRow = {
    id: "capsule-1",
    owner_id: "owner-1",
    manifest_json: JSON.stringify(baseManifest),
    hash: "hash-1",
    quarantined: 0,
    quarantine_reason: null,
    quarantined_at: null,
    created_at: 1_700_000_000,
    ...overrides,
  };

  const prepare = vi.fn((sql: string) => {
    const stmt: any = {
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async first() {
        if (sql.includes("FROM capsules")) {
          return capsule;
        }
        return null;
      },
      async all() {
        const first = await this.first();
        return { results: first ? [first] : [] };
      },
    };
    return stmt;
  });

  return {
    DB: { prepare } as any,
    R2: {} as any,
    RUNTIME_MANIFEST_KV: {} as any,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "https://example.com",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    vibecodr_analytics_engine: {} as any,
  } as Env;
}

describe("capsule quarantine visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAuthMock.mockResolvedValue(null as any);
    isModeratorOrAdminMock.mockReturnValue(false);
    verifyCapsuleIntegrityMock.mockResolvedValue(true);
    getCapsuleMetadataMock.mockResolvedValue({
      uploadedAt: 1_700_000_000,
      totalSize: 0,
      fileCount: 0,
      contentHash: "hash-1",
      owner: "owner-1",
    });
    checkPublicRateLimitMock.mockResolvedValue({ allowed: true });
  });

  it("blocks quarantined capsules for non-owners", async () => {
    const env = createEnv({
      quarantined: 1,
      quarantine_reason: "suspicious pattern",
      quarantined_at: 1_700_000_100,
    });

    const res = await getCapsule(
      new Request("https://example.com/capsules/capsule-1"),
      env,
      {} as any,
      { p1: "capsule-1" }
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ code: "E-VIBECODR-0509" });
  });

  it("allows owners to access quarantined capsules and returns moderation details", async () => {
    const env = createEnv({
      quarantined: 1,
      quarantine_reason: "heuristic_quarantine",
      quarantined_at: 1_700_000_200,
    });

    const owner: AuthenticatedUser = {
      userId: "owner-1",
      sessionId: "sess-1",
      claims: {} as any,
    };
    verifyAuthMock.mockResolvedValueOnce(owner);

    const res = await getCapsule(
      new Request("https://example.com/capsules/capsule-1"),
      env,
      {} as any,
      { p1: "capsule-1" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.moderation).toMatchObject({
      state: "quarantine",
      quarantined: true,
      quarantineReason: "heuristic_quarantine",
    });
  });

  it("blocks quarantine verification checks for non-owners", async () => {
    const env = createEnv({
      quarantined: 1,
      quarantine_reason: "suspicious pattern",
    });

    const res = await verifyCapsule(
      new Request("https://example.com/capsules/capsule-1/verify"),
      env,
      {} as any,
      { p1: "capsule-1" }
    );

    expect(res.status).toBe(404);
  });

  it("returns allow state for non-quarantined capsules", async () => {
    const env = createEnv({ quarantined: 0 });

    const res = await verifyCapsule(
      new Request("https://example.com/capsules/capsule-1/verify"),
      env,
      {} as any,
      { p1: "capsule-1" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.moderation).toMatchObject({ state: "allow", quarantined: false });
  });
});
