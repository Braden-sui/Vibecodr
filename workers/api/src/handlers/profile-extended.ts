// Extended profile handlers: layout, theming, and search
// References: research-social-platforms.md (Profiles section)

import type { Handler, Env } from "../index";
import { verifyAuth } from "../auth";
import {
  updateProfileSchema,
  type UpdateProfileInput,
  profileThemeSchema,
  profileBlockConfigSchema,
  type ProfileThemeInput,
  type ProfileBlockConfig,
} from "../schema";

type Params = Record<string, string>;

function json(data: unknown, status = 200, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

async function viewerFollowsOwner(env: Env, viewerId: string | null, ownerId: string): Promise<boolean> {
  if (!viewerId) return false;
  if (viewerId === ownerId) return true;
  const row = await env.DB.prepare(
    "SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?",
  )
    .bind(viewerId, ownerId)
    .first();
  return !!row;
}

function mapThemeRow(row: any | null | undefined): ProfileThemeInput | null {
  if (!row) return null;
  const base = {
    mode: row.mode ?? "system",
    accentHue: Number(row.accent_hue ?? 260),
    accentSaturation: Number(row.accent_saturation ?? 80),
    accentLightness: Number(row.accent_lightness ?? 60),
    radiusScale: Number(row.radius_scale ?? 2),
    density: row.density ?? "comfortable",
  };
  // Validate to avoid leaking malformed rows
  const parsed = profileThemeSchema.safeParse(base);
  if (!parsed.success) {
    console.error("E-VIBECODR-1002 invalid profile theme row", {
      error: parsed.error.message,
    });
    return null;
  }
  return parsed.data;
}

function parseBlockConfig(raw: unknown, userId: string, blockId: string): ProfileBlockConfig | null {
  const parsed = profileBlockConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("E-VIBECODR-1003 invalid profile block config", {
      userId,
      blockId,
      error: parsed.error.message,
    });
    return null;
  }
  return parsed.data;
}

/**
 * GET /profile/:handle
 * Public profile payload with layout and theming.
 */
export const getProfileWithLayout: Handler = async (req, env, ctx, params) => {
  const handle = params.p1;

  try {
    const authed = await verifyAuth(req, env);
    const viewerId = authed?.userId ?? null;

    const user = await env.DB.prepare(
      "SELECT id, handle, name, avatar_url, bio, plan, created_at FROM users WHERE handle = ?",
    )
      .bind(handle)
      .first();

    if (!user) {
      return json({ error: "User not found" }, 404);
    }

    const ownerId = String((user as any).id);

    const [profileRow, themeRow, blocksResult, projectsResult, badgesResult] = await Promise.all([
      env.DB.prepare(
        "SELECT tagline, location, website_url, x_handle, github_handle, pronouns, about_md FROM profiles WHERE user_id = ?",
      )
        .bind(ownerId)
        .first(),
      env.DB.prepare(
        "SELECT mode, accent_hue, accent_saturation, accent_lightness, radius_scale, density FROM profile_themes WHERE user_id = ?",
      )
        .bind(ownerId)
        .first(),
      env.DB.prepare(
        "SELECT id, type, position, visibility, config_json FROM profile_blocks WHERE user_id = ? ORDER BY position ASC",
      )
        .bind(ownerId)
        .all(),
      env.DB.prepare(
        "SELECT id, title, description, cover_key, tags, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 12",
      )
        .bind(ownerId)
        .all(),
      env.DB.prepare(
        "SELECT b.id, b.slug, b.label, b.description, b.icon, b.tier FROM user_badges ub INNER JOIN badges b ON ub.badge_id = b.id WHERE ub.user_id = ?",
      )
        .bind(ownerId)
        .all(),
    ]);

    const followerAllowed = await viewerFollowsOwner(env, viewerId, ownerId);

    const blocks: Array<{
      id: string;
      type: string;
      position: number;
      visibility: "public" | "followers" | "private";
      config: ProfileBlockConfig;
    }> = [];

    for (const row of (blocksResult.results || []) as any[]) {
      const visibility = (row.visibility || "public") as
        | "public"
        | "followers"
        | "private";

      if (visibility === "private" && viewerId !== ownerId) {
        continue;
      }
      if (visibility === "followers" && !followerAllowed) {
        continue;
      }

      let parsedConfig: ProfileBlockConfig | null = null;
      try {
        const parsedJson = row.config_json ? JSON.parse(row.config_json) : {};
        parsedConfig = parseBlockConfig(parsedJson, ownerId, String(row.id));
      } catch (error) {
        console.error("E-VIBECODR-1004 profile block JSON parse failed", {
          userId: ownerId,
          blockId: row.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (!parsedConfig) continue;

      blocks.push({
        id: String(row.id),
        type: String(row.type),
        position: Number(row.position ?? 0),
        visibility,
        config: parsedConfig,
      });
    }

    const projects = (projectsResult.results || []).map((row: any) => ({
      id: String(row.id),
      title: String(row.title),
      description: row.description as string | null,
      coverKey: row.cover_key as string | null,
      tags: row.tags ? ((JSON.parse(String(row.tags)) as string[]) || []) : [],
      createdAt: Number(row.created_at ?? 0),
    }));

    const badges = (badgesResult.results || []).map((row: any) => ({
      id: String(row.id),
      slug: String(row.slug),
      label: String(row.label),
      description: row.description as string | null,
      icon: row.icon as string | null,
      tier: row.tier as string | null,
    }));

    const theme = mapThemeRow(themeRow as any);

    const payload = {
      user: {
        id: String(user.id),
        handle: String(user.handle),
        name: (user as any).name ?? null,
        avatarUrl: (user as any).avatar_url ?? null,
        bio: (user as any).bio ?? null,
        plan: (user as any).plan ?? "free",
        createdAt: (user as any).created_at,
      },
      header: {
        tagline: profileRow?.tagline ?? null,
        location: profileRow?.location ?? null,
        websiteUrl: profileRow?.website_url ?? null,
        xHandle: profileRow?.x_handle ?? null,
        githubHandle: profileRow?.github_handle ?? null,
        pronouns: profileRow?.pronouns ?? null,
      },
      aboutMd: profileRow?.about_md ?? null,
      theme,
      blocks,
      projects,
      badges,
    };

    return json(payload);
  } catch (error) {
    return json(
      {
        error: "Failed to fetch profile layout",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
};

/**
 * PATCH /profile
 * Update profile core fields, theme, custom fields, and blocks.
 */
export const updateProfile: Handler = async (req, env, ctx, params) => {
  const authed = await verifyAuth(req, env);
  if (!authed) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "Validation failed",
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  const data: UpdateProfileInput = parsed.data;
  const userId = authed.userId;
  const now = Math.floor(Date.now() / 1000);

  try {
    // Upsert profiles row
    await env.DB.prepare(
      `INSERT INTO profiles (user_id, tagline, location, website_url, x_handle, github_handle, pronouns, about_md, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tagline = excluded.tagline,
         location = excluded.location,
         website_url = excluded.website_url,
         x_handle = excluded.x_handle,
         github_handle = excluded.github_handle,
         pronouns = excluded.pronouns,
         about_md = excluded.about_md,
         updated_at = excluded.updated_at`,
    )
      .bind(
        userId,
        data.tagline ?? null,
        data.location ?? null,
        data.websiteUrl ?? null,
        data.xHandle ?? null,
        data.githubHandle ?? null,
        data.pronouns ?? null,
        data.aboutMd ?? null,
        now,
      )
      .run();

    if (data.theme) {
      const safeTheme = profileThemeSchema.parse(data.theme);
      await env.DB.prepare(
        `INSERT INTO profile_themes (user_id, mode, accent_hue, accent_saturation, accent_lightness, radius_scale, density)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           mode = excluded.mode,
           accent_hue = excluded.accent_hue,
           accent_saturation = excluded.accent_saturation,
           accent_lightness = excluded.accent_lightness,
           radius_scale = excluded.radius_scale,
           density = excluded.density`,
      )
        .bind(
          userId,
          safeTheme.mode,
          safeTheme.accentHue,
          safeTheme.accentSaturation,
          safeTheme.accentLightness,
          safeTheme.radiusScale,
          safeTheme.density,
        )
        .run();
    }

    if (data.customFields) {
      await env.DB.prepare("DELETE FROM custom_fields WHERE user_id = ?")
        .bind(userId)
        .run();

      for (const field of data.customFields) {
        const id = field.id ?? crypto.randomUUID();
        const cfg = field.config
          ? JSON.stringify({
              options: field.config.options,
              defaultValue: field.config.defaultValue,
            })
          : null;
        await env.DB.prepare(
          `INSERT INTO custom_fields (id, user_id, key, label, type, icon, config_json, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            id,
            userId,
            field.key,
            field.label,
            field.type,
            field.icon ?? null,
            cfg,
            field.position ?? 0,
          )
          .run();
      }
    }

    if (data.blocks) {
      await env.DB.prepare("DELETE FROM profile_blocks WHERE user_id = ?")
        .bind(userId)
        .run();

      data.blocks.forEach(async (block, index) => {
        const safeBlock = profileBlockConfigSchema.parse(block);
        const id = (block as any).id ?? crypto.randomUUID();
        const position = (block as any).position ?? index;
        const visibility = safeBlock.visibility ?? "public";
        await env.DB.prepare(
          `INSERT INTO profile_blocks (id, user_id, type, position, visibility, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            id,
            userId,
            safeBlock.type,
            position,
            visibility,
            JSON.stringify(safeBlock),
            now,
            now,
          )
          .run();
      });
    }

    return json({ ok: true });
  } catch (error) {
    return json(
      {
        error: "Failed to update profile",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
};

/**
 * GET /profile/search?q=...
 */
export const searchProfiles: Handler = async (req, env, ctx, params) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = parseInt(url.searchParams.get("limit") || "20");

  if (!q) {
    return json({ profiles: [], q, limit });
  }

  const like = `%${q}%`;

  try {
    const { results } = await env.DB.prepare(
      `
      SELECT u.id, u.handle, u.name, u.avatar_url, u.bio,
             p.tagline, p.location, p.search_tags
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE
        LOWER(u.handle) LIKE ?
        OR LOWER(u.name) LIKE ?
        OR (p.search_tags IS NOT NULL AND LOWER(p.search_tags) LIKE ?)
      ORDER BY u.handle ASC
      LIMIT ?
    `,
    )
      .bind(like, like, like, limit)
      .all();

    const profiles = (results || []).map((row: any) => ({
      id: String(row.id),
      handle: String(row.handle),
      name: row.name as string | null,
      avatarUrl: row.avatar_url as string | null,
      bio: row.bio as string | null,
      tagline: row.tagline as string | null,
      location: row.location as string | null,
    }));

    return json({ profiles, q, limit });
  } catch (error) {
    return json(
      {
        error: "Failed to search profiles",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
};
