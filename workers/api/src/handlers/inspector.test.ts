/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env } from "../types";
import { inspectArtifact, inspectCapsule } from "./inspector";

vi.mock("../auth", () => ({
  requireAdmin: (handler: any) => handler,
  requireAuth: (handler: any) => handler,
  verifyAuth: vi.fn(),
}));

const runtimeManifest = {
  artifactId: "art-1",
  bundle: { r2Key: "artifacts/art-1/bundle.js" },
  runtime: { version: "v0.1.0" },
};

const interestingEvents = new Set([
  "runtime_policy_violation",
  "runtime_budget_exceeded",
  "runtime_killed",
  "runtime_error",
  "runtime_loader_error",
  "runtime_manifest_error",
  "runtime_frame_error",
  "runtime_security_warning",
  "runtime_events_capped",
]);

function makeEnv() {
  const prepare = vi.fn((sql: string) => {
    const stmt: any = {
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async first() {
        if (sql.includes("FROM artifacts a")) {
          return {
            id: "art-1",
            owner_id: "owner-1",
            capsule_id: "cap-1",
            type: "react-jsx",
            runtime_version: "v0.1.0",
            status: "active",
            policy_status: "active",
            visibility: "public",
            safety_tier: "default",
            risk_score: 0,
            created_at: 1_700_000_000,
            capsule_id_alias: "cap-1",
            capsule_owner_id: "owner-1",
            capsule_manifest_json: JSON.stringify({
              version: "1.0",
              runner: "client-static",
              entry: "index.html",
            }),
            capsule_hash: "capsule-hash",
            capsule_quarantined: 0,
            capsule_quarantine_reason: null,
            capsule_created_at: 1_700_000_000,
          };
        }
        if (sql.includes("FROM artifacts") && sql.includes("capsule_id")) {
          return {
            id: "art-1",
            owner_id: "owner-1",
            capsule_id: "cap-1",
            type: "react-jsx",
            runtime_version: "v0.1.0",
            status: "active",
            policy_status: "active",
            visibility: "public",
            safety_tier: "default",
            risk_score: 0,
            created_at: 1_700_000_000,
          };
        }
        if (sql.includes("FROM artifact_manifests")) {
          return {
            manifest_json: JSON.stringify(runtimeManifest),
            version: 2,
            runtime_version: "v0.1.0",
          };
        }
        if (sql.includes("FROM capsules")) {
          return {
            id: "cap-1",
            owner_id: "owner-1",
            manifest_json: JSON.stringify({
              version: "1.0",
              runner: "client-static",
              entry: "index.html",
            }),
            hash: "capsule-hash",
            quarantined: 0,
            quarantine_reason: null,
            created_at: 1_700_000_000,
          };
        }
        return null;
      },
      async all() {
        if (sql.includes("FROM runtime_events")) {
          const filtered = [
            {
              id: "evt-1",
              event_name: "runtime_policy_violation",
              capsule_id: "cap-1",
              artifact_id: "art-1",
              runtime_type: "react-jsx",
              runtime_version: "v0.1.0",
              code: "E-VIBECODR-2121",
              message: "storage blocked",
              properties: JSON.stringify({ scope: "localStorage" }),
              created_at: 1_700_000_100,
            },
            {
              id: "evt-2",
              event_name: "player_run_completed",
              capsule_id: "cap-1",
              artifact_id: "art-1",
              runtime_type: "react-jsx",
              runtime_version: "v0.1.0",
              message: "ok",
              created_at: 1_700_000_000,
            },
          ].filter((row) => interestingEvents.has(row.event_name));

          return {
            results: filtered,
          };
        }

        return { results: [] };
      },
    };
    return stmt;
  });

  const r2 = {
    get: vi.fn(async (key: string) => {
      if (key.endsWith("manifest.json")) {
        return {
          json: async () => ({
            version: "1.0",
            runner: "client-static",
            entry: "index.html",
          }),
        };
      }
      return null;
    }),
  };

  const compileStub = {
    fetch: vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          lastCompileRequest: { artifactId: "art-1", receivedAt: 1_700_000_000 },
          lastCompileResult: { artifactId: "art-1", outcome: "success" },
        }),
        { status: 200 }
      );
    }),
  };

  const env: Env = {
    DB: { prepare } as any,
    R2: r2 as any,
    RUNTIME_MANIFEST_KV: undefined,
    ALLOWLIST_HOSTS: "[]",
    CLERK_JWT_ISSUER: "https://issuer.test",
    CLERK_JWT_AUDIENCE: "",
    BUILD_COORDINATOR_DURABLE: {} as any,
    ARTIFACT_COMPILER_DURABLE: {
      idFromName: vi.fn(() => ({ id: "stub" })),
      get: vi.fn(() => compileStub),
    } as any,
    RATE_LIMIT_SHARD: {} as any,
    vibecodr_analytics_engine: {} as any,
  };

  return { env, prepare, compileStub };
}

describe("inspector handlers", () => {
  let env: Env;
  let compileStub: { fetch: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const setup = makeEnv();
    env = setup.env;
    compileStub = setup.compileStub as any;
  });

  it("returns artifact inspection data with filtered events and compile state", async () => {
    const res = await inspectArtifact(
      new Request("https://worker.test/admin/artifacts/art-1/inspect", { method: "GET" }),
      env,
      {} as any,
      { p1: "art-1" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.artifact.id).toBe("art-1");
    expect(body.capsule.id).toBe("cap-1");
    expect(body.runtimeManifest.manifest.artifactId).toBe("art-1");
    expect(body.events).toHaveLength(1);
    expect(body.compile.lastCompileResult.artifactId).toBe("art-1");
    expect(compileStub.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns capsule inspection data with latest artifact", async () => {
    const res = await inspectCapsule(
      new Request("https://worker.test/admin/capsules/cap-1/inspect", { method: "GET" }),
      env,
      {} as any,
      { p1: "cap-1" }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.capsule.id).toBe("cap-1");
    expect(body.latestArtifact?.id).toBe("art-1");
    expect(body.runtimeManifest?.manifest?.artifactId).toBe("art-1");
  });
});
