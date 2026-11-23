// template/src/app/api/auto-theme/route.ts
import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { TOP_APP_PRESETS } from "@/lib/constants";
import type { Scene, ScreenshotFontId } from "@/lib/types";

export const dynamic = "force-dynamic";

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

export async function POST() {
  try {
    const screenshotsDir = path.join(process.cwd(), "public", "screenshots");

    if (!fsSync.existsSync(screenshotsDir)) {
      return NextResponse.json({ ok: false, error: "Screenshots directory not found" }, { status: 404 });
    }

    const allFiles = await fs.readdir(screenshotsDir);
    const files = allFiles
      .filter((f) => /^slide-\d+.*\.png$/.test(f) && !f.includes("thumb"))
      .slice(0, 10);

    const yukaPreset = TOP_APP_PRESETS.find((p) => p.id === "app-yuka")!;

    if (files.length === 0) {
      return NextResponse.json({
        ok: true,
        themeId: yukaPreset.themeId,
        themeName: yukaPreset.name,
        fontId: yukaPreset.fontId,
        scene: yukaPreset.scene,
        topAppReference: yukaPreset.name,
        dominantBrand: "#10B981",
        reason: "Defaulted to Yuka organic scanner style.",
      });
    }

    const hueBuckets = {
      green: 0,
      blue: 0,
      purple: 0,
      red: 0,
      orange: 0,
      teal: 0,
      yellow: 0,
    };

    let totalLuminance = 0;
    let pixelCount = 0;
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

          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          totalLuminance += lum;
          pixelCount++;

          const { h, s, v } = rgbToHsv(r, g, b);

          // Focus on chromatic UI brand colors (buttons, badges, icons, tabs)
          if (v > 0.22 && v < 0.98 && s > 0.28) {
            const weight = s * s * v;

            if (h >= 75 && h <= 165) {
              hueBuckets.green += weight;
            } else if (h > 165 && h <= 195) {
              hueBuckets.teal += weight;
            } else if (h > 195 && h <= 255) {
              hueBuckets.blue += weight;
            } else if (h > 255 && h <= 315) {
              hueBuckets.purple += weight;
            } else if (h > 315 || h <= 15) {
              hueBuckets.red += weight;
            } else if (h > 15 && h < 45) {
              hueBuckets.orange += weight;
            } else if (h >= 45 && h < 75) {
              hueBuckets.yellow += weight;
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

    const avgLuminance = pixelCount > 0 ? totalLuminance / pixelCount : 0.8;
    const isDarkMode = avgLuminance < 0.38;

    const sortedColors = Array.from(colorMap.entries()).sort((a, b) => b[1] - a[1]);
    const dominantBrand = sortedColors.length > 0 ? sortedColors[0][0] : "#10B981";

    const entries = Object.entries(hueBuckets).sort((a, b) => b[1] - a[1]);
    const topHue = entries[0][1] > 1.5 ? entries[0][0] : "none";

    let chosenThemeId = "app-yuka";
    let chosenThemeName = "Yuka · Organic Health Scanner";
    let chosenFontId: ScreenshotFontId = "helvetica-neue";
    let chosenScene: Scene = yukaPreset.scene;
    let topAppReference = "Yuka (Organic Health Scanner)";
    let reason = "Detected eco-health UI with emerald status indicators (#10B981). Matched to Yuka's organic Swiss grid.";

    if (isDarkMode) {
      if (topHue === "green" || topHue === "blue" || topHue === "teal") {
        const p = TOP_APP_PRESETS.find((x) => x.id === "app-revolut")!;
        chosenThemeId = p.themeId;
        chosenThemeName = p.name;
        chosenFontId = p.fontId;
        chosenScene = p.scene;
        topAppReference = "Revolut & Cash App";
        reason = "Detected dark mode interface with electric accents. Generated Revolut neo-fintech spotlight look.";
      } else {
        const p = TOP_APP_PRESETS.find((x) => x.id === "app-raycast")!;
        chosenThemeId = p.themeId;
        chosenThemeName = p.name;
        chosenFontId = p.fontId;
        chosenScene = p.scene;
        topAppReference = "Raycast & Arc Search";
        reason = "Detected dark titanium UI. Generated Raycast cyber obsidian scene with balanced glow.";
      }
    } else {
      // Light Mode App
      if (topHue === "green" || topHue === "teal") {
        const p = TOP_APP_PRESETS.find((x) => x.id === "app-yuka")!;
        chosenThemeId = p.themeId;
        chosenThemeName = p.name;
        chosenFontId = p.fontId;
        chosenScene = p.scene;
        topAppReference = "Yuka (Organic Health Scanner)";
        reason = "Detected eco-health scanner UI with emerald green accents (#10B981). Matched to Yuka's award-winning Swiss grid.";
      } else if (topHue === "orange") {
        const p = TOP_APP_PRESETS.find((x) => x.id === "app-blinkist")!;
        chosenThemeId = p.themeId;
        chosenThemeName = p.name;
        chosenFontId = p.fontId;
        chosenScene = p.scene;
        topAppReference = "Blinkist & Headspace";
        reason = "Detected warm amber and terracotta tones. Generated Blinkist warm editorial scene with serif type.";
      } else if (topHue === "yellow") {
        const p = TOP_APP_PRESETS.find((x) => x.id === "app-duolingo")!;
        chosenThemeId = p.themeId;
        chosenThemeName = p.name;
        chosenFontId = p.fontId;
        chosenScene = p.scene;
        topAppReference = "Duolingo & Strava";
        reason = "Detected playful high-energy bright hues. Generated Duolingo playful pop scene with sparkles.";
      } else if (topHue === "red") {
        const p = TOP_APP_PRESETS.find((x) => x.id === "app-airbnb")!;
        chosenThemeId = p.themeId;
        chosenThemeName = p.name;
        chosenFontId = p.fontId;
        chosenScene = p.scene;
        topAppReference = "Airbnb & Uber";
        reason = "Detected clean red and coral accents. Generated Airbnb clean minimal luxury gallery look.";
      } else if (topHue === "blue") {
        chosenThemeId = "ocean-fresh";
        chosenThemeName = "Ocean Fresh (Coinbase & Calm)";
        chosenFontId = "system-sans";
        chosenScene = {
          backdrop: "gradient",
          span: true,
          decoration: "blobs",
          shadow: 35,
          glow: 15,
          tilt: 0,
          headlineWeight: 700,
          headlineScale: 0.98,
          headlineCase: "as-typed",
          captionAlign: "center",
        };
        topAppReference = "Coinbase & Calm";
        reason = "Detected fresh blue palette. Generated calm oceanic gradient scene with centered typography.";
      } else {
        // Clean neutral / B2B SaaS
        const p = TOP_APP_PRESETS.find((x) => x.id === "app-linear")!;
        chosenThemeId = p.themeId;
        chosenThemeName = p.name;
        chosenFontId = p.fontId;
        chosenScene = p.scene;
        topAppReference = "Linear & Notion";
        reason = "Detected clean high-contrast neutral interface. Generated Linear modernist Swiss grid scene.";
      }
    }

    return NextResponse.json({
      ok: true,
      themeId: chosenThemeId,
      themeName: chosenThemeName,
      fontId: chosenFontId,
      scene: chosenScene,
      topAppReference,
      dominantBrand,
      reason,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
