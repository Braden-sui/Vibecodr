import type { CSSProperties } from "react";
import type { ProfileTheme } from "./schema";

export function themeToInlineStyle(theme: ProfileTheme | null | undefined): CSSProperties {
  if (!theme) return {};
  const accent = `${theme.accentHue} ${theme.accentSaturation}% ${theme.accentLightness}%`;

  return {
    ["--vc-accent" as string]: `hsl(${accent})`,
    ["--vc-radius" as string]: theme.radiusScale === 1 ? "0.25rem" : theme.radiusScale === 3 ? "1rem" : "0.5rem",
  };
}
