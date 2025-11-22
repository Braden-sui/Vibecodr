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
    accentColor: row.accent_color ?? null,
    bgColor: row.bg_color ?? null,
    textColor: row.text_color ?? null,
    fontFamily: row.font_family ?? null,
    coverImageUrl: row.cover_image_url ?? null,
    glass: row.glass === 1 || row.glass === true,
    canvasBlur:
      row.canvas_blur === null || row.canvas_blur === undefined
        ? undefined
        : Number(row.canvas_blur),
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

function allowEmbedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host.endsWith("vibecodr.space") || host.endsWith("vibecodr.com");
  } catch {
    return false;
  }
}

function sanitizeBlock(block: ProfileBlockConfig): ProfileBlockConfig | null {
  const next = { ...block, props: { ...(block.props ?? {}) } as Record<string, unknown> };

  switch (block.type) {
    case "links": {
      const rawLinks = Array.isArray((next.props as any).links) ? ((next.props as any).links as any[]) : [];
      const links: Array<{ label: string; url: string }> = [];
      for (const entry of rawLinks) {
        const label =
          typeof (entry as any)?.label === "string" ? (entry as any).label.trim().slice(0, 80) : "";
        const url = typeof (entry as any)?.url === "string" ? (entry as any).url.trim() : "";
        if (!label || !url) continue;
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
          links.push({ label, url: parsed.toString() });
        } catch {
          continue;
        }
        if (links.length >= 12) break;
      }
      (next.props as any).links = links;
      break;
    }
    case "markdown":
    case "text": {
      const content = typeof (next.props as any)?.content === "string" ? (next.props as any).content : "";
      (next.props as any).content = content.slice(0, block.type === "markdown" ? 8000 : 2000);
      break;
    }
    case "capsuleEmbed": {
      const embedUrl = typeof (next.props as any)?.embedUrl === "string" ? (next.props as any).embedUrl.trim() : "";
      if (embedUrl && !allowEmbedHost(embedUrl)) {
        return null;
      }
      const heightRaw = Number((next.props as any)?.height ?? 360);
      const height = Number.isFinite(heightRaw) ? Math.min(1200, Math.max(240, Math.round(heightRaw))) : 360;
      (next.props as any).embedUrl = embedUrl;
      (next.props as any).height = height;
      break;
    }
    default:
      break;
  }

  return next;
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

    let themeRow: any = null;
    try {
      themeRow = await env.DB.prepare(
        `SELECT mode, accent_hue, accent_saturation, accent_lightness, radius_scale, density,
                accent_color, bg_color, text_color, font_family, cover_image_url, glass, canvas_blur
         FROM profile_themes WHERE user_id = ?`,
      )
        .bind(ownerId)
        .first();
    } catch (error) {
      console.error("E-VIBECODR-1006 profile theme lookup failed", {
        userId: ownerId,
        message: error instanceof Error ? error.message : String(error),
      });
      themeRow = null;
    }

    let badgesResult: any = { results: [] };
    try {
      badgesResult = await env.DB.prepare(
        "SELECT b.id, b.slug, b.label, b.description, b.icon, b.tier FROM user_badges ub INNER JOIN badges b ON ub.badge_id = b.id WHERE ub.user_id = ?",
      )
        .bind(ownerId)
        .all();
    } catch (error) {
      console.error("E-VIBECODR-1007 profile badges lookup failed", {
        userId: ownerId,
        message: error instanceof Error ? error.message : String(error),
      });
      badgesResult = { results: [] };
    }

    const [profileRow, blocksResult, projectsResult] = await Promise.all([
      env.DB.prepare(
        `SELECT display_name, avatar_url, bio, tagline, location, website_url, x_handle, github_handle, pronouns, about_md, pinned_capsules, profile_capsule_id
         FROM profiles WHERE user_id = ?`,
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
        const rawConfig = parseBlockConfig(parsedJson, ownerId, String(row.id));
        parsedConfig = rawConfig ? sanitizeBlock(rawConfig) : null;
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

    if (blocks.length === 0) {
      const defaultTypes: ProfileBlockConfig["type"][] = ["banner", "about", "links", "projects", "badges"];
      for (const [index, type] of defaultTypes.entries()) {
        const baseConfig = {
          version: 1,
          type,
          visibility: "public",
          props: {},
        } as ProfileBlockConfig;
        const sanitized = sanitizeBlock(baseConfig);
        if (!sanitized) continue;
        blocks.push({
          id: `default-${type}`,
          type,
          position: index,
          visibility: sanitized.visibility ?? "public",
          config: sanitized,
        });
      }
    }

    const theme = mapThemeRow(themeRow as any) ?? profileThemeSchema.parse({});

    const resolvedName = profileRow?.display_name ?? (user as any).name ?? null;
    const resolvedAvatar = profileRow?.avatar_url ?? (user as any).avatar_url ?? null;
    const resolvedBio = profileRow?.bio ?? (user as any).bio ?? null;

    let pinnedCapsules: string[] = [];
    if (profileRow?.pinned_capsules) {
      try {
        const parsed = JSON.parse(String(profileRow.pinned_capsules));
        if (Array.isArray(parsed)) {
          pinnedCapsules = parsed.filter((x) => typeof x === "string").slice(0, 12) as string[];
        }
      } catch {
        pinnedCapsules = [];
      }
    }
    const profileCapsuleId =
      profileRow?.profile_capsule_id && typeof profileRow.profile_capsule_id === "string"
        ? profileRow.profile_capsule_id
        : null;

    const payload = {
      user: {
        id: String(user.id),
        handle: String(user.handle),
        name: resolvedName,
        avatarUrl: resolvedAvatar,
        bio: resolvedBio,
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
      pinnedCapsules,
      profileCapsuleId,
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
      `INSERT INTO profiles (user_id, display_name, avatar_url, bio, tagline, location, website_url, x_handle, github_handle, pronouns, about_md, pinned_capsules, profile_capsule_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         bio = excluded.bio,
         tagline = excluded.tagline,
         location = excluded.location,
         website_url = excluded.website_url,
         x_handle = excluded.x_handle,
         github_handle = excluded.github_handle,
         pronouns = excluded.pronouns,
         about_md = excluded.about_md,
         pinned_capsules = excluded.pinned_capsules,
         profile_capsule_id = excluded.profile_capsule_id,
         updated_at = excluded.updated_at`,
    )
      .bind(
        userId,
        data.displayName ?? null,
        data.avatarUrl ?? null,
        data.bio ?? null,
        data.tagline ?? null,
        data.location ?? null,
        data.websiteUrl ?? null,
        data.xHandle ?? null,
        data.githubHandle ?? null,
        data.pronouns ?? null,
        data.aboutMd ?? null,
        data.pinnedCapsules ? JSON.stringify(data.pinnedCapsules) : null,
        data.profileCapsuleId ?? null,
        now,
      )
      .run();

    if (data.theme) {
      const safeTheme = profileThemeSchema.parse(data.theme);
      await env.DB.prepare(
        `INSERT INTO profile_themes (
           user_id, mode, accent_hue, accent_saturation, accent_lightness, radius_scale, density,
           accent_color, bg_color, text_color, font_family, cover_image_url, glass, canvas_blur
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           mode = excluded.mode,
           accent_hue = excluded.accent_hue,
           accent_saturation = excluded.accent_saturation,
           accent_lightness = excluded.accent_lightness,
           radius_scale = excluded.radius_scale,
           density = excluded.density,
           accent_color = excluded.accent_color,
           bg_color = excluded.bg_color,
           text_color = excluded.text_color,
           font_family = excluded.font_family,
           cover_image_url = excluded.cover_image_url,
           glass = excluded.glass,
           canvas_blur = excluded.canvas_blur`,
      )
        .bind(
          userId,
          safeTheme.mode,
          safeTheme.accentHue,
          safeTheme.accentSaturation,
          safeTheme.accentLightness,
          safeTheme.radiusScale,
          safeTheme.density,
          safeTheme.accentColor ?? null,
          safeTheme.bgColor ?? null,
          safeTheme.textColor ?? null,
          safeTheme.fontFamily ?? null,
          safeTheme.coverImageUrl ?? null,
          safeTheme.glass ? 1 : 0,
          safeTheme.canvasBlur ?? null,
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

      for (const [index, block] of data.blocks.entries()) {
        const safeBlock = profileBlockConfigSchema.parse(block);
        const sanitized = sanitizeBlock(safeBlock);
        if (!sanitized) {
          return json({ error: "Validation failed", details: "Invalid block config" }, 400);
        }
        const id = (block as any).id ?? crypto.randomUUID();
        const position = (block as any).position ?? index;
        const visibility = sanitized.visibility ?? "public";
        await env.DB.prepare(
          `INSERT INTO profile_blocks (id, user_id, type, position, visibility, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            id,
            userId,
            sanitized.type,
            position,
            visibility,
            JSON.stringify(sanitized),
            now,
            now,
          )
          .run();
      }
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
