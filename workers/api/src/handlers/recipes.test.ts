/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCapsuleRecipe,
  listCapsuleRecipes,
  updateCapsuleRecipe,
  deleteCapsuleRecipe,
  CAPSULE_RECIPE_LIMIT,
} from "./recipes";
import type { Env } from "../types";

type RecipeRow = {
  id: string;
  capsule_id: string;
  author_id: string;
  name: string;
  params_json: string;
  created_at?: number | null;
};

type UserRow = {
  id: string;
  handle?: string | null;
  name?: string | null;
  avatar_url?: string | null;
};

const resolveCapsuleAccessMock = vi.fn();

vi.mock("../capsule-access", () => ({
  resolveCapsuleAccess: (...args: unknown[]) => resolveCapsuleAccessMock(...args),
}));

vi.mock("../auth", () => ({
  requireAuth:
    (handler: any) =>
    (req: Request, env: Env, ctx: any, params: Record<string, string>) =>
      handler(req, env, ctx, params, {
        userId: "user-creator",
        sessionId: "sess-1",
        claims: {},
      }),
}));

function createEnv(recipes: RecipeRow[] = [], users: UserRow[] = []): Env & { __state: { recipes: Map<string, RecipeRow>; users: Map<string, UserRow> } } {
  const state = {
    recipes: new Map<string, RecipeRow>(recipes.map((row) => [row.id, { ...row }])),
    users: new Map<string, UserRow>(users.map((row) => [row.id, { ...row }])),
  };

  const prepare = (sql: string) => {
    const stmt: any = {
      sql,
      bindArgs: [] as any[],
      bind(...args: any[]) {
        this.bindArgs = args;
        return this;
      },
      async all() {
        if (sql.includes("FROM capsule_recipes") && sql.includes("JOIN users")) {
          const [capsuleId, limitRaw, offsetRaw] = this.bindArgs;
          const limit = Number.isFinite(limitRaw) ? Number(limitRaw) : state.recipes.size;
          const offset = Number.isFinite(offsetRaw) ? Number(offsetRaw) : 0;
          const rows = Array.from(state.recipes.values())
            .filter((row) => row.capsule_id === capsuleId)
            .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
            .slice(offset, offset + limit);

          const mapped = rows.map((row) => {
            const user = state.users.get(row.author_id);
            return {
              ...row,
              author_handle: user?.handle ?? null,
              author_name: user?.name ?? null,
              author_avatar: user?.avatar_url ?? null,
            };
          });
          return { results: mapped };
        }
        return { results: [] };
      },
      async first() {
        if (sql.startsWith("SELECT COUNT(*) as count FROM capsule_recipes")) {
          const capsuleId = this.bindArgs[0];
          const count = Array.from(state.recipes.values()).filter(
            (row) => row.capsule_id === capsuleId
          ).length;
          return { count };
        }
        if (sql.includes("FROM capsule_recipes") && sql.includes("WHERE r.id = ?")) {
          const [id, capsuleId] = this.bindArgs;
          const row = state.recipes.get(String(id));
          if (!row || row.capsule_id !== capsuleId) return null;
          const user = state.users.get(row.author_id);
          return {
            ...row,
            author_handle: user?.handle ?? null,
            author_name: user?.name ?? null,
            author_avatar: user?.avatar_url ?? null,
          };
        }
        if (sql.includes("FROM users")) {
          const userId = this.bindArgs[0];
          return state.users.get(userId) ?? null;
        }
        return null;
      },
      async run() {
        if (sql.startsWith("INSERT INTO capsule_recipes")) {
          const [id, capsuleId, authorId, name, paramsJson] = this.bindArgs;
          state.recipes.set(id, {
            id,
            capsule_id: capsuleId,
            author_id: authorId,
            name,
            params_json: paramsJson,
            created_at: Math.floor(Date.now() / 1000),
          });
          return { success: true };
        }
        if (sql.startsWith("UPDATE capsule_recipes")) {
          const [name, paramsJson, recipeId, capsuleId] = this.bindArgs;
          const existing = state.recipes.get(recipeId);
          if (!existing || existing.capsule_id !== capsuleId) {
            return { changes: 0 };
          }
          if (name !== null && name !== undefined) {
            existing.name = name;
          }
          if (paramsJson !== null && paramsJson !== undefined) {
            existing.params_json = paramsJson;
          }
          state.recipes.set(recipeId, existing);
          return { changes: 1 };
        }
        if (sql.startsWith("DELETE FROM capsule_recipes")) {
          const [recipeId, capsuleId] = this.bindArgs;
          const existing = state.recipes.get(recipeId);
          if (!existing || existing.capsule_id !== capsuleId) {
            return { changes: 0 };
          }
          state.recipes.delete(recipeId);
          return { changes: 1 };
        }
        throw new Error(`Unsupported SQL in test stub: ${sql}`);
      },
    };
    return stmt;
  };

  const env: any = {
    DB: { prepare },
    R2: {},
    ALLOWLIST_HOSTS: "[]",
    __state: state,
  };
  return env;
}

function buildAccess(manifestJson: string) {
  return {
    capsule: {
      id: "capsule-123",
      owner_id: "owner-1",
      manifest_json: manifestJson,
      hash: "hash-1",
    },
    moderation: {
      state: "allow" as const,
      quarantined: false,
      quarantineReason: null,
      quarantinedAt: null,
    },
    viewerId: "user-creator",
    viewerIsOwner: false,
    viewerIsMod: false,
  };
}

const manifestWithParams = JSON.stringify({
  version: "1.0",
  runner: "client-static",
  entry: "index.html",
  params: [
    { name: "speed", type: "slider", label: "Speed", default: 1, min: 0, max: 2 },
    { name: "monochrome", type: "toggle", label: "Monochrome", default: false },
  ],
});

describe("capsule recipes handlers", () => {
  beforeEach(() => {
    resolveCapsuleAccessMock.mockReset();
  });

  it("lists recipes with normalized params and author info", async () => {
    resolveCapsuleAccessMock.mockResolvedValue(buildAccess(manifestWithParams));
    const env = createEnv(
      [
        {
          id: "recipe-1",
          capsule_id: "capsule-123",
          author_id: "user-creator",
          name: "Chaos",
          params_json: JSON.stringify({ speed: 5, monochrome: "not-boolean", extra: "ignore" }),
          created_at: 100,
        },
      ],
      [
        {
          id: "user-creator",
          handle: "creator",
          name: "Creator",
        },
      ],
    );

    const response = await listCapsuleRecipes(
      new Request("https://example.com/capsules/capsule-123/recipes"),
      env,
      {} as any,
      { p1: "capsule-123" }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.recipes)).toBe(true);
    expect(body.recipes[0].name).toBe("Chaos");
    expect(body.recipes[0].params).toEqual({ speed: 2 });
    expect(body.recipes[0].author.handle).toBe("creator");
  });

  it("creates a recipe when payload is valid", async () => {
    resolveCapsuleAccessMock.mockResolvedValue(buildAccess(manifestWithParams));
    const env = createEnv([], [
      { id: "user-creator", handle: "creator", name: "Creator Name", avatar_url: "http://a" },
    ]);

    const response = await createCapsuleRecipe(
      new Request("https://example.com/capsules/capsule-123/recipes", {
        method: "POST",
        body: JSON.stringify({
          name: " Slow Motion ",
          params: { speed: 0.3, monochrome: true },
        }),
      }),
      env,
      {} as any,
      { p1: "capsule-123" }
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.recipe.name).toBe("Slow Motion");
    expect(body.recipe.params).toEqual({ speed: 0.3, monochrome: true });
    expect(body.recipe.author.handle).toBe("creator");

    const saved = env.__state.recipes.get(body.recipe.id);
    expect(saved).toBeDefined();
    expect(saved?.capsule_id).toBe("capsule-123");
  });

  it("rejects creation when recipe limit is reached", async () => {
    resolveCapsuleAccessMock.mockResolvedValue(buildAccess(manifestWithParams));
    const filled: RecipeRow[] = [];
    for (let i = 0; i < CAPSULE_RECIPE_LIMIT; i += 1) {
      filled.push({
        id: `recipe-${i}`,
        capsule_id: "capsule-123",
        author_id: "user-creator",
        name: `Recipe ${i}`,
        params_json: "{}",
        created_at: i,
      });
    }
    const env = createEnv(filled, [{ id: "user-creator", handle: "creator" }]);

    const response = await createCapsuleRecipe(
      new Request("https://example.com/capsules/capsule-123/recipes", {
        method: "POST",
        body: JSON.stringify({
          name: "Overflow",
          params: { speed: 1 },
        }),
      }),
      env,
      {} as any,
      { p1: "capsule-123" }
    );

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.code).toBe("E-VIBECODR-0732");
  });

  it("rejects creation when no params match the manifest", async () => {
    resolveCapsuleAccessMock.mockResolvedValue(buildAccess(manifestWithParams));
    const env = createEnv([], [{ id: "user-creator", handle: "creator" }]);

    const response = await createCapsuleRecipe(
      new Request("https://example.com/capsules/capsule-123/recipes", {
        method: "POST",
        body: JSON.stringify({
          name: "Empty",
          params: { unknown: true },
        }),
      }),
      env,
      {} as any,
      { p1: "capsule-123" }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("E-VIBECODR-0731");
  });

  it("updates an existing recipe when authorized", async () => {
    resolveCapsuleAccessMock.mockResolvedValue(buildAccess(manifestWithParams));
    const env = createEnv(
      [
        {
          id: "recipe-1",
          capsule_id: "capsule-123",
          author_id: "user-creator",
          name: "Original",
          params_json: JSON.stringify({ speed: 1 }),
          created_at: 10,
        },
      ],
      [{ id: "user-creator", handle: "creator" }]
    );

    const response = await updateCapsuleRecipe(
      new Request("https://example.com/capsules/capsule-123/recipes/recipe-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated", params: { speed: 1.5, monochrome: true } }),
      }),
      env,
      {} as any,
      { p1: "capsule-123", p2: "recipe-1" }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recipe.name).toBe("Updated");
    expect(body.recipe.params).toEqual({ speed: 1.5, monochrome: true });
    expect(env.__state.recipes.get("recipe-1")?.name).toBe("Updated");
  });

  it("deletes a recipe when authorized", async () => {
    resolveCapsuleAccessMock.mockResolvedValue(buildAccess(manifestWithParams));
    const env = createEnv(
      [
        {
          id: "recipe-1",
          capsule_id: "capsule-123",
          author_id: "user-creator",
          name: "ToDelete",
          params_json: JSON.stringify({ speed: 1 }),
        },
      ],
      [{ id: "user-creator", handle: "creator" }]
    );

    const response = await deleteCapsuleRecipe(
      new Request("https://example.com/capsules/capsule-123/recipes/recipe-1", {
        method: "DELETE",
      }),
      env,
      {} as any,
      { p1: "capsule-123", p2: "recipe-1" }
    );

    expect(response.status).toBe(200);
    expect(env.__state.recipes.size).toBe(0);
  });

  it("rejects update when user is not the author or capsule owner/mod", async () => {
    resolveCapsuleAccessMock.mockResolvedValue({
      ...buildAccess(manifestWithParams),
      viewerId: "user-creator",
      viewerIsOwner: false,
      viewerIsMod: false,
    });
    const env = createEnv(
      [
        {
          id: "recipe-1",
          capsule_id: "capsule-123",
          author_id: "other-user",
          name: "Original",
          params_json: JSON.stringify({ speed: 1 }),
        },
      ],
      [{ id: "other-user", handle: "other" }]
    );

    const response = await updateCapsuleRecipe(
      new Request("https://example.com/capsules/capsule-123/recipes/recipe-1", {
        method: "PATCH",
        body: JSON.stringify({ params: { speed: 1.7 } }),
      }),
      env,
      {} as any,
      { p1: "capsule-123", p2: "recipe-1" }
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("E-VIBECODR-0734");
  });
});
