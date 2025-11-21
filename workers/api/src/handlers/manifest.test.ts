import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Manifest } from "@vibecodr/shared/manifest";
import type { Env } from "../index";
import { getCapsuleBundle, getManifest } from "./manifest";
import { verifyAuth, isModeratorOrAdmin } from "../auth";

vi.mock("../auth", () => ({
  verifyAuth: vi.fn(),
  isModeratorOrAdmin: vi.fn(),
}));

const verifyAuthMock = vi.mocked(verifyAuth);
const isModeratorOrAdminMock = vi.mocked(isModeratorOrAdmin);

type CapsuleRow = {
  id: string;
  owner_id: string;
  manifest_json: string;
  hash: string;
};

type ArtifactRow = {
  id: string;
  status: string;
  policy_status: string;
  visibility: string;
  created_at?: number;
};

type PostRow = {
  author_id: string;
  visibility: string;
  quarantined?: number | null;
};

const baseManifest: Manifest = {
  version: "1.0",
  runner: "client-static",
  entry: "index.html",
};

function createEnv(options?: {
  capsule?: CapsuleRow | null;
  artifacts?: ArtifactRow[];
  posts?: PostRow[];
  manifest?: Manifest;
}): Env {
  const capsule: CapsuleRow | null =
    options?.capsule ??
    ({
      id: "c1",
      owner_id: "owner-1",
      manifest_json: JSON.stringify(options?.manifest ?? baseManifest),
      hash: "hash-1",
    } as CapsuleRow);

  const artifacts: ArtifactRow[] = options?.artifacts ?? [];
  const posts: PostRow[] = options?.posts ?? [];
  const manifest = options?.manifest ?? baseManifest;

  const r2Objects = new Map<string, any>();
  if (capsule) {
    r2Objects.set(`capsules/${capsule.hash}/manifest.json`, {
      json: async () => manifest,
    });
    r2Objects.set(`capsules/${capsule.hash}/${manifest.entry}`, {
      body: new TextEncoder().encode("bundle-content"),
    });
  }

  const prepare = vi.fn((sql: string) => {
    const stmt: any = {
      sql,
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async all() {
        if (sql.includes("FROM capsules")) {
          return { results: capsule ? [capsule] : [] };
        }
        if (sql.includes("FROM artifacts")) {
          return { results: artifacts };
        }
        if (sql.includes("FROM posts")) {
          return { results: posts };
        }
        return { results: [] };
      },
      async first() {
        const result = await this.all();
        return (result as any).results?.[0] ?? null;
      },
      async run() {
        return { success: true };
      },
    };
    return stmt;
  });

  return {
    DB: { prepare } as any,
    R2: {
      get: vi.fn(async (key: string) => r2Objects.get(key) ?? null),
    } as any,
    RUNTIME_MANIFEST_KV: undefined,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "https://example.com",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {} as any,
    vibecodr_analytics_engine: {} as any,
  } as Env;
}

describe("manifest and bundle access controls", () => {
  beforeEach(() => {
    verifyAuthMock.mockReset();
    verifyAuthMock.mockResolvedValue(null as any);
    isModeratorOrAdminMock.mockReset();
    isModeratorOrAdminMock.mockReturnValue(false);
  });

  it("returns 404 for capsules with quarantined artifacts", async () => {
    const env = createEnv({
      artifacts: [
        {
          id: "a1",
          status: "quarantined",
          policy_status: "quarantined",
          visibility: "public",
        },
      ],
      posts: [{ author_id: "owner-1", visibility: "public", quarantined: 0 }],
    });

    const res = await getManifest(
      new Request("https://api.example/capsules/c1/manifest"),
      env,
      {} as any,
      { p1: "c1" }
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("E-VIBECODR-0601");
  });

  it("blocks bundle downloads when all posts for the capsule are quarantined", async () => {
    const env = createEnv({
      artifacts: [
        { id: "a1", status: "active", policy_status: "active", visibility: "public" },
      ],
      posts: [{ author_id: "owner-1", visibility: "public", quarantined: 1 }],
    });

    const res = await getCapsuleBundle(
      new Request("https://api.example/capsules/c1/bundle"),
      env,
      {} as any,
      { p1: "c1" }
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("E-VIBECODR-0601");
  });

  it("requires ownership to download private artifacts", async () => {
    const env = createEnv({
      artifacts: [
        { id: "a1", status: "active", policy_status: "active", visibility: "private" },
      ],
      posts: [{ author_id: "owner-1", visibility: "public", quarantined: 0 }],
    });

    verifyAuthMock.mockResolvedValueOnce(null as any);
    const anon = await getCapsuleBundle(
      new Request("https://api.example/capsules/c1/bundle"),
      env,
      {} as any,
      { p1: "c1" }
    );
    expect(anon.status).toBe(404);

    verifyAuthMock.mockResolvedValueOnce({
      userId: "owner-1",
      sessionId: "s1",
      claims: {} as any,
    });

    const owner = await getCapsuleBundle(
      new Request("https://api.example/capsules/c1/bundle"),
      env,
      {} as any,
      { p1: "c1" }
    );
    expect(owner.status).toBe(200);
  });
});
