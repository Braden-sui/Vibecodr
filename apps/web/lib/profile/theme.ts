import type { CSSProperties } from "react";
import type { ProfileTheme } from "./schema";

export function themeToInlineStyle(theme: ProfileTheme | null | undefined): CSSProperties {
  if (!theme) return {};
  const hue = Number.isFinite(theme.accentHue) ? theme.accentHue : 260;
  const accent = theme.accentColor ?? `hsl(${hue} ${theme.accentSaturation}% ${theme.accentLightness}%)`;
  const bg = theme.bgColor ?? `hsl(${hue} 32% 7%)`;
  const surface = `hsl(${hue} 28% 11%)`;
  const card = `hsl(${hue} 22% 15%)`;
  const fg = theme.textColor ?? "hsl(0 0% 96%)";
  const muted = `hsla(${hue} 18% 78% / 0.75)`;

  const vars: CSSProperties = {
    ["--vc-bg" as string]: bg,
    ["--vc-surface" as string]: surface,
    ["--vc-card" as string]: card,
    ["--vc-fg" as string]: fg,
    ["--vc-muted" as string]: muted,
    ["--vc-accent" as string]: accent,
    ["--vc-radius" as string]:
      theme.radiusScale === 1 ? "0.25rem" : theme.radiusScale === 3 ? "1rem" : theme.radiusScale >= 4 ? "1.5rem" : "0.5rem",
    ["--vc-font" as string]: theme.fontFamily ?? "Inter, system-ui, sans-serif",
    ["--vc-cover-image" as string]: theme.coverImageUrl ? `url(${theme.coverImageUrl})` : "none",
    ["--vc-glass" as string]: theme.glass ? "1" : "0",
    ["--vc-canvas-blur" as string]: `${theme.canvasBlur ?? 0}px`,
  };

  if (theme.coverImageUrl) {
    vars.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.72), rgba(0,0,0,0.9)), url(${theme.coverImageUrl})`;
    vars.backgroundSize = "cover";
    vars.backgroundPosition = "center";
  }

  vars.backgroundColor = bg;

  return vars;
}
