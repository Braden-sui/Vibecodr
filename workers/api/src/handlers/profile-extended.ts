// Extended profile handlers: layout, theming, and search
// References: research-social-platforms.md (Profiles section)

import { Plan, normalizePlan } from "@vibecodr/shared";
import type { Handler, Env } from "../types";
import { verifyAuth } from "../auth";
import { json } from "../lib/responses";
import {
  updateProfileSchema,
  type UpdateProfileInput,
  profileThemeSchema,
  profileBlockConfigSchema,
  type ProfileThemeInput,
  type ProfileBlockConfig,
} from "../schema";

type Params = Record<string, string>;

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

function mapThemeRow(row: unknown): ProfileThemeInput | null {
  if (!row || typeof row !== "object") return null;
  const data = row as Record<string, unknown>;
  const base = {
    mode: typeof data.mode === "string" ? data.mode : "system",
    accentHue: Number(data.accent_hue ?? 260),
    accentSaturation: Number(data.accent_saturation ?? 80),
    accentLightness: Number(data.accent_lightness ?? 60),
    radiusScale: Number(data.radius_scale ?? 2),
    density: typeof data.density === "string" ? data.density : "comfortable",
    accentColor: (data.accent_color as string | null | undefined) ?? null,
    bgColor: (data.bg_color as string | null | undefined) ?? null,
    textColor: (data.text_color as string | null | undefined) ?? null,
    fontFamily: (data.font_family as string | null | undefined) ?? null,
    coverImageUrl: (data.cover_image_url as string | null | undefined) ?? null,
    glass: data.glass === 1 || data.glass === true,
    canvasBlur:
      data.canvas_blur === null || data.canvas_blur === undefined
        ? undefined
        : Number(data.canvas_blur),
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

function readLinks(raw: unknown): Array<{ label: string; url: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (entry && typeof entry === "object") {
      const candidate = entry as { label?: unknown; url?: unknown };
      return {
        label: typeof candidate.label === "string" ? candidate.label : "",
        url: typeof candidate.url === "string" ? candidate.url : "",
      };
    }
    return { label: "", url: "" };
  });
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function sanitizeBlock(block: ProfileBlockConfig): ProfileBlockConfig | null {
  const props = { ...(block.props ?? {}) } as Record<string, unknown>;
  const next: ProfileBlockConfig = { ...block, props };

  switch (block.type) {
    case "links": {
      const rawLinks = readLinks(props.links);
      const links: Array<{ label: string; url: string }> = [];
      for (const entry of rawLinks) {
        const label = typeof entry.label === "string" ? entry.label.trim().slice(0, 80) : "";
        const url = typeof entry.url === "string" ? entry.url.trim() : "";
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
      props.links = links;
      break;
    }
    case "markdown":
    case "text": {
      const content = typeof props.content === "string" ? props.content : "";
      props.content = content.slice(0, block.type === "markdown" ? 8000 : 2000);
      break;
    }
    case "capsuleEmbed": {
      const embedUrl = typeof props.embedUrl === "string" ? props.embedUrl.trim() : "";
      if (embedUrl && !allowEmbedHost(embedUrl)) {
        return null;
      }
      const heightRaw = Number(props.height ?? 360);
      const height = Number.isFinite(heightRaw) ? Math.min(1200, Math.max(240, Math.round(heightRaw))) : 360;
      props.embedUrl = embedUrl;
      props.height = height;
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

    const ownerId = String((user as { id?: unknown }).id ?? "");

    let themeRow: unknown = null;
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

    let badgesResult: unknown = { results: [] as unknown[] };
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

    for (const row of asArray<Record<string, unknown>>(blocksResult.results)) {
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
        const parsedJson = row.config_json ? JSON.parse(row.config_json as string) : {};
        const rawConfig = parseBlockConfig(parsedJson, ownerId, String(row.id ?? ""));
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

    const projects = asArray<Record<string, unknown>>(projectsResult.results).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      description: row.description as string | null,
      coverKey: row.cover_key as string | null,
      tags: row.tags ? ((JSON.parse(String(row.tags)) as string[]) || []) : [],
      createdAt: Number(row.created_at ?? 0),
    }));

    const badges = asArray<Record<string, unknown>>((badgesResult as { results?: unknown }).results).map((row) => ({
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

    const theme = mapThemeRow(themeRow) ?? profileThemeSchema.parse({});

    const userRecord = user as Record<string, unknown>;
  const resolvedName = profileRow?.display_name ?? (userRecord.name as string | null | undefined) ?? null;
  const resolvedAvatar = profileRow?.avatar_url ?? (userRecord.avatar_url as string | null | undefined) ?? null;
  const resolvedBio = profileRow?.bio ?? (userRecord.bio as string | null | undefined) ?? null;
  const plan = normalizePlan(userRecord.plan, Plan.FREE);

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
      plan,
      createdAt: userRecord.created_at,
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
        const blockId = typeof (block as { id?: unknown }).id === "string" ? (block as { id?: string }).id : crypto.randomUUID();
        const positionValue = (block as { position?: unknown }).position;
        const position = typeof positionValue === "number" ? positionValue : index;
        const visibility = sanitized.visibility ?? "public";
        await env.DB.prepare(
          `INSERT INTO profile_blocks (id, user_id, type, position, visibility, config_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            blockId,
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
