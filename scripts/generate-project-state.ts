// scripts/generate-project-state.ts
import * as fs from "fs";
import * as path from "path";

export interface SlideConfig {
  id: string;
  order: number;
  screenshotFileName: string;
  topLabel: string;
  headline: string;
  subtext: string;
  layoutVariant?: "hero" | "device-bottom" | "device-center" | "two-devices" | "callout-focus" | string;
  callout?: {
    title: string;
    description: string;
    focusX: number;
    focusY: number;
    zoom: number;
  };
}

export function buildAppStoreScreenshotsJson(
  appName: string,
  stylePreset: string,
  accentColor: string,
  slides: SlideConfig[],
  appId?: string
) {
  const templatePath = path.resolve(process.cwd(), "template/app-store-screenshots.json");
  const publicScreenshotsDir = path.resolve(process.cwd(), "template/public/screenshots");

  // Helper to generate a clean, store-approved slide object with balanced single & multi-device rhythm
  const createSlideObject = (s: SlideConfig, idx: number, platform: "ios" | "android") => {
    // Dynamic layout rhythm:
    // - Slide 1 (Intro): Hero single device
    // - Slide 2 (Key Feature): Two-devices composition (e.g. Scan + History)
    // - Slide 3 & 4: Clean single device
    // - Slide 5 (Core Insight): Two-devices composition (if deck has >= 5 slides)
    // - Final Slide: Hero single device
    let layout: "hero" | "device-bottom" | "two-devices" = "device-bottom";
    if (idx === 0 || (idx === slides.length - 1 && slides.length > 3)) {
      layout = "hero";
    } else if (idx === 1 || (idx === 4 && slides.length >= 6)) {
      layout = "two-devices";
    }

    // Determine platform-specific sanitized screenshot
    const iosFileName = `slide-${idx + 1}-ios.png`;
    const androidFileName = `slide-${idx + 1}-android.png`;

    let screenshotPath = `/screenshots/${s.screenshotFileName}`;
    if (platform === "ios" && fs.existsSync(path.join(publicScreenshotsDir, iosFileName))) {
      screenshotPath = `/screenshots/${iosFileName}`;
    } else if (platform === "android" && fs.existsSync(path.join(publicScreenshotsDir, androidFileName))) {
      screenshotPath = `/screenshots/${androidFileName}`;
    }

    const slideObj: any = {
      id: `s_pipeline_${idx + 1}`,
      layout,
      label: { en: (s.topLabel || "FEATURE").toUpperCase() },
      headline: { en: s.headline || "Headline Goes Here" },
      screenshot: screenshotPath,
    };

    // If two-devices, pair with a complementary screen
    if (layout === "two-devices") {
      let secIndex = idx === 1 ? 1 : idx === 4 ? 6 : idx;
      const secIos = `slide-${secIndex}-ios.png`;
      const secAndroid = `slide-${secIndex}-android.png`;
      if (platform === "ios" && fs.existsSync(path.join(publicScreenshotsDir, secIos))) {
        slideObj.screenshotSecondary = `/screenshots/${secIos}`;
      } else if (platform === "android" && fs.existsSync(path.join(publicScreenshotsDir, secAndroid))) {
        slideObj.screenshotSecondary = `/screenshots/${secAndroid}`;
      } else {
        slideObj.screenshotSecondary = screenshotPath;
      }
    }

    if (s.callout) {
      slideObj.callout = {
        focusX: s.callout.focusX > 1 ? s.callout.focusX / 100 : s.callout.focusX,
        focusY: s.callout.focusY > 1 ? s.callout.focusY / 100 : s.callout.focusY,
        zoom: s.callout.zoom || 1.8,
        shape: "circle",
      };
    }

    return slideObj;
  };

  const templateSlidesIos = slides.map((s, idx) => createSlideObject(s, idx, "ios"));
  const templateSlidesAndroid = slides.map((s, idx) => createSlideObject(s, idx, "android"));

  const projectState = {
    schemaVersion: 3,
    appName: appName || "Mobile App",
    themeId: stylePreset || "swiss-grid-bold",
    fontId: "helvetica-neue",
    connectedCanvas: false,
    locales: ["en"],
    locale: "en",
    device: "android",
    orientation: "portrait",
    appIcon: "/mockup.png",
    scene: {
      backdrop: "grid",
      span: false,
      decoration: "none",
      shadow: 28,
      glow: 0,
      tilt: 0,
      headlineWeight: 700,
      headlineScale: 0.95,
      headlineCase: "as-typed",
      captionAlign: "left",
    },
    slidesByDevice: {
      iphone: templateSlidesIos,
      ipad: templateSlidesIos,
      android: templateSlidesAndroid,
      "android-7": templateSlidesAndroid,
      "android-10": templateSlidesAndroid,
    },
    meta: {
      appName: appName || "Mobile App",
      appId: appId || "default-app",
      lastModified: new Date().toISOString(),
      stylePreset: stylePreset || "swiss-grid-bold",
    },
    globalStyles: {
      fontFamily: "Inter",
      backgroundColor: "#F2F1EC",
      primaryColor: accentColor || "#C23B00",
      accentColor: accentColor || "#C23B00",
      deviceFrame: "iphone-16-pro",
      showAppIcon: true,
      appIconPath: "/mockup.png",
    },
  };

  fs.writeFileSync(templatePath, JSON.stringify(projectState, null, 2), "utf-8");
  console.log(`[State Generator] Successfully generated balanced rhythm deck in ${templatePath}`);
}
