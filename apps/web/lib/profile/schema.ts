import { z } from "zod";

const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  .max(9);

export const profileThemeSchema = z.object({
  mode: z.enum(["system", "light", "dark"]).default("system"),
  accentHue: z.number().int().min(0).max(360).default(260),
  accentSaturation: z.number().int().min(0).max(100).default(80),
  accentLightness: z.number().int().min(0).max(100).default(60),
  radiusScale: z.number().int().min(1).max(4).default(2),
  density: z.enum(["comfortable", "cozy", "compact"]).default("comfortable"),
  accentColor: hexColor.optional().nullable(),
  bgColor: hexColor.optional().nullable(),
  textColor: hexColor.optional().nullable(),
  fontFamily: z.string().max(120).optional().nullable(),
  coverImageUrl: z.string().url().max(500).optional().nullable(),
  glass: z.boolean().optional(),
  canvasBlur: z.number().int().min(0).max(64).optional(),
});

export const profileBlockSchema = z.object({
  id: z.string().optional(),
  version: z.literal(1),
  type: z.enum([
    "header",
    "about",
    "activity",
    "projects",
    "badges",
    "text",
    "markdown",
    "links",
    "stats",
    "imageGallery",
    "videoEmbed",
    "banner",
    "capsuleGrid",
    "capsuleEmbed",
  ]),
  visibility: z.enum(["public", "followers", "private"]).default("public"),
  position: z.number().int().min(0).default(0),
  props: z.record(z.string(), z.unknown()).default({}),
});

export const customFieldDefinitionSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1).max(32),
  label: z.string().min(1).max(64),
  type: z.enum(["text", "number", "url", "date", "select", "multiselect"]),
  icon: z.string().max(64).optional(),
  options: z.array(z.string()).optional(),
  defaultValue: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
  position: z.number().int().min(0).default(0),
});

export const updateProfilePayloadSchema = z.object({
  displayName: z.string().max(80).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  bio: z.string().max(500).nullable().optional(),
  tagline: z.string().max(160).nullable().optional(),
  location: z.string().max(80).nullable().optional(),
  websiteUrl: z.string().url().max(255).nullable().optional(),
  xHandle: z.string().max(50).nullable().optional(),
  githubHandle: z.string().max(50).nullable().optional(),
  pronouns: z.string().max(40).nullable().optional(),
  aboutMd: z.string().max(8000).nullable().optional(),
  theme: profileThemeSchema.optional(),
  customFields: z.array(customFieldDefinitionSchema).optional(),
  blocks: z.array(profileBlockSchema).optional(),
  pinnedCapsules: z.array(z.string().max(64)).max(12).optional(),
  profileCapsuleId: z.string().max(64).nullable().optional(),
});

export type ProfileTheme = z.infer<typeof profileThemeSchema>;
export type ProfileBlock = z.infer<typeof profileBlockSchema>;
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;
export type UpdateProfilePayload = z.infer<typeof updateProfilePayloadSchema>;
