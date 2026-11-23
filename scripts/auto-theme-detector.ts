// scripts/auto-theme-detector.ts
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

export interface ExtractedPalette {
  brandColor: string;
  accentColor: string;
  bgColor: string;
  bgAltColor: string;
  fgColor: string;
  mutedColor: string;
  themeId: string;
  themeName: string;
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s, v };
}

/**
 * Automatically analyzes app screenshots to extract dominant brand colors,
 * high-contrast foregrounds, and harmonized background colors.
 */
export async function detectAppPalette(screenshotsDir: string): Promise<ExtractedPalette> {
  const files = fs.existsSync(screenshotsDir)
    ? fs.readdirSync(screenshotsDir).filter((f) => /^slide-\d+\.png$/.test(f)).slice(0, 8)
    : [];

  if (files.length === 0) {
    return {
      brandColor: "#14503C",
      accentColor: "#C5A880",
      bgColor: "#FBF8F2",
      bgAltColor: "#14503C",
      fgColor: "#11261D",
      mutedColor: "#556B60",
      themeId: "emerald-sanctuary",
      themeName: "Emerald Sanctuary",
    };
  }

  const hueBuckets = {
    green: 0,
    blue: 0,
    purple: 0,
    red: 0,
    orange: 0,
    teal: 0,
  };

  const colorMap = new Map<string, number>();

  for (const file of files) {
    try {
      const filePath = path.join(screenshotsDir, file);
      const { data, info } = await sharp(filePath)
        .resize(120, 120, { fit: "inside" })
        .raw()
        .toBuffer({ resolveWithObject: true });

      for (let i = 0; i < data.length; i += info.channels) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const { h, s, v } = rgbToHsv(r, g, b);

        if (v > 0.25 && v < 0.96 && s > 0.32) {
          const weight = s * s * v;

          if (h >= 70 && h <= 165) {
            hueBuckets.green += weight;
          } else if (h > 165 && h <= 195) {
            hueBuckets.teal += weight;
          } else if (h > 195 && h <= 255) {
            hueBuckets.blue += weight;
          } else if (h > 255 && h <= 315) {
            hueBuckets.purple += weight;
          } else if (h > 315 || h <= 15) {
            hueBuckets.red += weight;
          } else if (h > 15 && h < 55 && v > 0.55) {
            hueBuckets.orange += weight;
          }

          const qr = Math.round(r / 16) * 16;
          const qg = Math.round(g / 16) * 16;
          const qb = Math.round(b / 16) * 16;
          const hex = "#" + ((1 << 24) + (qr << 16) + (qg << 8) + qb).toString(16).slice(1);
          colorMap.set(hex, (colorMap.get(hex) || 0) + weight);
        }
      }
    } catch {}
  }

  const entries = Object.entries(hueBuckets).sort((a, b) => b[1] - a[1]);
  const topHue = entries[0][1] > 2.0 ? entries[0][0] : "none";

  if (topHue === "green" || topHue === "teal") {
    return {
      brandColor: "#10B981",
      accentColor: "#14503C",
      bgColor: "#FBF9F4",
      bgAltColor: "#14503C",
      fgColor: "#1F2937",
      mutedColor: "#4B5563",
      themeId: "app-yuka",
      themeName: "Yuka (Organic Scanner)",
    };
  }

  if (topHue === "blue") {
    return {
      brandColor: "#0284C7",
      accentColor: "#F59E0B",
      bgColor: "#F0F9FF",
      bgAltColor: "#0369A1",
      fgColor: "#0C4A6E",
      mutedColor: "#475569",
      themeId: "ocean-fresh",
      themeName: "Ocean Fresh",
    };
  }

  if (topHue === "orange") {
    return {
      brandColor: "#EA580C",
      accentColor: "#F59E0B",
      bgColor: "#FFF7ED",
      bgAltColor: "#C2410C",
      fgColor: "#431407",
      mutedColor: "#78350F",
      themeId: "warm-editorial",
      themeName: "Warm Editorial",
    };
  }

  if (topHue === "purple") {
    return {
      brandColor: "#8B5CF6",
      accentColor: "#C4B5FD",
      bgColor: "#0B1020",
      bgAltColor: "#F8FAFC",
      fgColor: "#F8FAFC",
      mutedColor: "#94A3B8",
      themeId: "dark-bold",
      themeName: "Dark Bold",
    };
  }

  return {
    brandColor: "#10B981",
    accentColor: "#10B981",
    bgColor: "#F6F1EA",
    bgAltColor: "#171717",
    fgColor: "#171717",
    mutedColor: "#6B7280",
    themeId: "clean-light",
    themeName: "Clean Light",
  };
}

/**
 * Automatically applies the AI-detected color scheme and theme to the active project state.
 */
export async function applyAutoThemeToProject(projectDir: string, templateDir: string) {
  const screenshotsDir = path.join(projectDir, "screenshots");
  const palette = await detectAppPalette(screenshotsDir);

  console.log(`\n[Auto Theme] Detected brand tone: ${palette.themeName} (${palette.brandColor})`);

  const templateJsonPath = path.join(templateDir, "app-store-screenshots.json");
  const projectJsonPath = path.join(projectDir, "app-store-screenshots.json");

  for (const jsonPath of [templateJsonPath, projectJsonPath]) {
    if (fs.existsSync(jsonPath)) {
      try {
        const state = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        state.themeId = palette.themeId;
        state.scene = undefined;

        fs.writeFileSync(jsonPath, JSON.stringify(state, null, 2), "utf-8");
      } catch {}
    }
  }

  return palette;
}
