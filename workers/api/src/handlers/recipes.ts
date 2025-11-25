import { z } from "zod";
import type { Env, Handler } from "../types";
import { requireAuth } from "../auth";
import { json } from "../lib/responses";
import { resolveCapsuleAccess } from "../capsule-access";
import { requireCapsuleManifest } from "../capsule-manifest";
import type { Manifest, ManifestParam } from "@vibecodr/shared/manifest";

type RecipeValue = string | number | boolean;

type RecipeRow = {
  id: string;
  capsule_id: string;
  author_id: string;
  name: string;
  params_json: string;
  created_at?: number | null;
  author_handle?: string | null;
  author_name?: string | null;
  author_avatar?: string | null;
};

type CapsuleRecipe = {
  id: string;
  capsuleId: string;
  name: string;
  params: Record<string, RecipeValue>;
  author: {
    id: string;
    handle: string | null;
    name: string | null;
    avatarUrl: string | null;
  };
  createdAt: number | null;
};

const MAX_RECIPE_NAME_LENGTH = 80;
const MAX_RECIPES_PER_CAPSULE = 100;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
export const CAPSULE_RECIPE_LIMIT = MAX_RECIPES_PER_CAPSULE;

const recipePayloadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "name_required")
    .max(MAX_RECIPE_NAME_LENGTH, "name_too_long"),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
});

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `recipe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clampNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === "number") {
    next = Math.max(min, next);
  }
  if (typeof max === "number") {
    next = Math.min(max, next);
  }
  return next;
}

function normalizeValue(param: ManifestParam, raw: unknown): RecipeValue | undefined {
  switch (param.type) {
    case "slider":
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
      return clampNumber(raw, param.min, param.max);
    }
    case "toggle": {
      return typeof raw === "boolean" ? raw : undefined;
    }
    case "select": {
      if (typeof raw !== "string") return undefined;
      return param.options && param.options.includes(raw) ? raw : undefined;
    }
    case "text": {
      if (typeof raw !== "string") return undefined;
      const limit = Math.min(Math.max(param.maxLength ?? 400, 1), 1000);
      return raw.slice(0, limit);
    }
    case "color": {
      if (typeof raw !== "string") return undefined;
      // INVARIANT: color strings stay short to avoid storage abuse.
      return raw.slice(0, 64);
    }
    default: {
      if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        return raw;
      }
      return undefined;
    }
  }
}

function normalizeRecipeParams(
  manifest: Manifest,
  params: Record<string, unknown> | null | undefined
): Record<string, RecipeValue> {
  if (!params || typeof params !== "object") {
    return {};
  }

  const manifestParams = Array.isArray(manifest.params) ? manifest.params : [];
  const manifestByName = new Map<string, ManifestParam>();
  for (const param of manifestParams) {
    manifestByName.set(param.name, param);
  }

  const normalized: Record<string, RecipeValue> = {};
  for (const [name, raw] of Object.entries(params)) {
    const def = manifestByName.get(name);
    if (!def) continue;
    const value = normalizeValue(def, raw);
    if (value !== undefined) {
      normalized[name] = value;
    }
  }

  return normalized;
}

function parseParamsJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapRowToRecipe(row: RecipeRow, manifest: Manifest): CapsuleRecipe | null {
  if (!row.id || !row.capsule_id) return null;
  const normalizedParams = normalizeRecipeParams(manifest, parseParamsJson(row.params_json));
  return {
    id: row.id,
    capsuleId: row.capsule_id,
    name: row.name || "Untitled",
    params: normalizedParams,
    author: {
      id: row.author_id,
      handle: row.author_handle ?? null,
      name: row.author_name ?? null,
      avatarUrl: row.author_avatar ?? null,
    },
    createdAt:
      typeof row.created_at === "number"
        ? row.created_at
        : row.created_at
          ? Number(row.created_at)
          : null,
  };
}

async function enforceRecipeLimit(env: Env, capsuleId: string): Promise<boolean> {
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM capsule_recipes WHERE capsule_id = ?"
  )
    .bind(capsuleId)
    .first();

  const countRaw = countRow as { count?: number } | null;
  const count = Number.isFinite(countRaw?.count) ? Number(countRaw?.count ?? 0) : 0;
  return count < MAX_RECIPES_PER_CAPSULE;
}

export const listCapsuleRecipes: Handler = async (req, env, _ctx, params) => {
  const capsuleId = params.p1;
  const access = await resolveCapsuleAccess(req, env, capsuleId);
  if (access instanceof Response) {
    return access;
  }

  const manifest = requireCapsuleManifest(access.capsule.manifest_json, {
    source: "capsule_recipes",
    capsuleId,
  });

  const url = new URL(req.url);
  const limitCandidate = Number(url.searchParams.get("limit"));
  const offsetCandidate = Number(url.searchParams.get("offset"));
  const limit = Number.isFinite(limitCandidate)
    ? Math.min(Math.max(Math.trunc(limitCandidate), 1), MAX_LIST_LIMIT)
    : DEFAULT_LIST_LIMIT;
  const offset = Number.isFinite(offsetCandidate) && offsetCandidate > 0 ? Math.trunc(offsetCandidate) : 0;

  const { results } = await env.DB.prepare(
    `SELECT
        r.id,
        r.capsule_id,
        r.author_id,
        r.name,
        r.params_json,
        r.created_at,
        u.handle as author_handle,
        u.name as author_name,
        u.avatar_url as author_avatar
      FROM capsule_recipes r
      LEFT JOIN users u ON u.id = r.author_id
      WHERE r.capsule_id = ?
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?`
  )
    .bind(capsuleId, limit, offset)
    .all();

  const recipes: CapsuleRecipe[] = [];
  for (const row of results || []) {
    const mapped = mapRowToRecipe(row as RecipeRow, manifest);
    if (mapped) {
      recipes.push(mapped);
    }
  }

  return json({ recipes, limit, offset });
};

export const createCapsuleRecipe: Handler = requireAuth(async (req, env, _ctx, params, user) => {
  const capsuleId = params.p1;
  const access = await resolveCapsuleAccess(req, env, capsuleId);
  if (access instanceof Response) {
    return access;
  }

  const manifest = requireCapsuleManifest(access.capsule.manifest_json, {
    source: "capsule_recipes",
    capsuleId,
  });

  if (!Array.isArray(manifest.params) || manifest.params.length === 0) {
    return json(
      { error: "Capsule has no parameters to save", code: "E-VIBECODR-0731" },
      400
    );
  }

  let parsed: z.infer<typeof recipePayloadSchema>;
  try {
    const body = await req.json();
    parsed = recipePayloadSchema.parse(body);
  } catch (error) {
    return json(
      {
        error: "Invalid recipe payload",
        code: "E-VIBECODR-0730",
        details: error instanceof Error ? error.message : undefined,
      },
      400
    );
  }

  const normalizedParams = normalizeRecipeParams(manifest, parsed.params);
  if (Object.keys(normalizedParams).length === 0) {
    return json(
      { error: "Recipe must include at least one valid parameter", code: "E-VIBECODR-0731" },
      400
    );
  }

  let withinLimit = true;
  try {
    withinLimit = await enforceRecipeLimit(env, capsuleId);
  } catch (error) {
    console.error("E-VIBECODR-0733 recipe limit check failed", {
      capsuleId,
      message: error instanceof Error ? error.message : String(error),
    });
    return json(
      { error: "Failed to save recipe", code: "E-VIBECODR-0733" },
      500
    );
  }
  if (!withinLimit) {
    return json(
      { error: "Recipe limit reached for this capsule", code: "E-VIBECODR-0732" },
      429
    );
  }

  const recipeId = createId();
  const name = parsed.name.slice(0, MAX_RECIPE_NAME_LENGTH).trim();
  const paramsJson = JSON.stringify(normalizedParams);

  try {
    await env.DB.prepare(
      "INSERT INTO capsule_recipes (id, capsule_id, author_id, name, params_json) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(recipeId, capsuleId, user.userId, name, paramsJson)
      .run();
  } catch (error) {
    console.error("E-VIBECODR-0733 recipe insert failed", {
      capsuleId,
      recipeId,
      authorId: user.userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return json(
      { error: "Failed to save recipe", code: "E-VIBECODR-0733" },
      500
    );
  }

  const authorProfile = await env.DB.prepare(
    "SELECT handle, name, avatar_url FROM users WHERE id = ? LIMIT 1"
  )
    .bind(user.userId)
    .first();

  const recipe: CapsuleRecipe = {
    id: recipeId,
    capsuleId,
    name,
    params: normalizedParams,
    author: {
      id: user.userId,
      handle: (authorProfile as any)?.handle ?? null,
      name: (authorProfile as any)?.name ?? null,
      avatarUrl: (authorProfile as any)?.avatar_url ?? null,
    },
    createdAt: Math.floor(Date.now() / 1000),
  };

  return json({ recipe }, 201);
});

const recipeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_RECIPE_NAME_LENGTH).optional(),
    params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .refine((value) => value.name !== undefined || value.params !== undefined, {
    message: "name_or_params_required",
  });

async function getRecipeRow(env: Env, capsuleId: string, recipeId: string): Promise<RecipeRow | null> {
  const row = await env.DB.prepare(
    `SELECT
      r.id,
      r.capsule_id,
      r.author_id,
      r.name,
      r.params_json,
      r.created_at,
      u.handle as author_handle,
      u.name as author_name,
      u.avatar_url as author_avatar
     FROM capsule_recipes r
     LEFT JOIN users u ON u.id = r.author_id
     WHERE r.id = ? AND r.capsule_id = ?
     LIMIT 1`
  )
    .bind(recipeId, capsuleId)
    .first();

  return (row as RecipeRow | null) ?? null;
}

function canMutateRecipe(
  userId: string,
  recipe: RecipeRow,
  viewerIsOwner: boolean,
  viewerIsMod: boolean
): boolean {
  return recipe.author_id === userId || viewerIsOwner || viewerIsMod;
}

export const updateCapsuleRecipe: Handler = requireAuth(async (req, env, _ctx, params, user) => {
  const capsuleId = params.p1;
  const recipeId = params.p2;
  const access = await resolveCapsuleAccess(req, env, capsuleId);
  if (access instanceof Response) {
    return access;
  }

  const manifest = requireCapsuleManifest(access.capsule.manifest_json, {
    source: "capsule_recipes",
    capsuleId,
  });

  const existing = await getRecipeRow(env, capsuleId, recipeId);
  if (!existing) {
    return json({ error: "Recipe not found", code: "E-VIBECODR-0735" }, 404);
  }

  if (!canMutateRecipe(user.userId, existing, access.viewerIsOwner, access.viewerIsMod)) {
    return json({ error: "Not allowed to modify this recipe", code: "E-VIBECODR-0734" }, 403);
  }

  let parsed: z.infer<typeof recipeUpdateSchema>;
  try {
    const body = await req.json();
    parsed = recipeUpdateSchema.parse(body);
  } catch (error) {
    return json(
      {
        error: "Invalid recipe payload",
        code: "E-VIBECODR-0730",
        details: error instanceof Error ? error.message : undefined,
      },
      400
    );
  }

  const updates: { name?: string; paramsJson?: string } = {};
  if (parsed.name !== undefined) {
    updates.name = parsed.name.slice(0, MAX_RECIPE_NAME_LENGTH).trim();
  }

  if (parsed.params !== undefined) {
    const normalizedParams = normalizeRecipeParams(manifest, parsed.params);
    if (Object.keys(normalizedParams).length === 0) {
      return json(
        { error: "Recipe must include at least one valid parameter", code: "E-VIBECODR-0731" },
        400
      );
    }
    updates.paramsJson = JSON.stringify(normalizedParams);
  }

  try {
    await env.DB.prepare(
      `UPDATE capsule_recipes
       SET name = COALESCE(?, name),
           params_json = COALESCE(?, params_json)
       WHERE id = ? AND capsule_id = ?`
    )
      .bind(updates.name ?? null, updates.paramsJson ?? null, recipeId, capsuleId)
      .run();
  } catch (error) {
    console.error("E-VIBECODR-0733 recipe update failed", {
      capsuleId,
      recipeId,
      authorId: user.userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "Failed to save recipe", code: "E-VIBECODR-0733" }, 500);
  }

  const updated = await getRecipeRow(env, capsuleId, recipeId);
  if (!updated) {
    return json({ error: "Recipe not found", code: "E-VIBECODR-0735" }, 404);
  }

  const mapped = mapRowToRecipe(updated, manifest);
  return json({ recipe: mapped }, 200);
});

export const deleteCapsuleRecipe: Handler = requireAuth(async (req, env, _ctx, params, user) => {
  const capsuleId = params.p1;
  const recipeId = params.p2;
  const access = await resolveCapsuleAccess(req, env, capsuleId);
  if (access instanceof Response) {
    return access;
  }

  const existing = await getRecipeRow(env, capsuleId, recipeId);
  if (!existing) {
    return json({ error: "Recipe not found", code: "E-VIBECODR-0735" }, 404);
  }

  if (!canMutateRecipe(user.userId, existing, access.viewerIsOwner, access.viewerIsMod)) {
    return json({ error: "Not allowed to modify this recipe", code: "E-VIBECODR-0734" }, 403);
  }

  try {
    await env.DB.prepare("DELETE FROM capsule_recipes WHERE id = ? AND capsule_id = ?")
      .bind(recipeId, capsuleId)
      .run();
  } catch (error) {
    console.error("E-VIBECODR-0733 recipe delete failed", {
      capsuleId,
      recipeId,
      authorId: user.userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "Failed to delete recipe", code: "E-VIBECODR-0733" }, 500);
  }

  return json({ ok: true }, 200);
});
