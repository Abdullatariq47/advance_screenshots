// scripts/manual-operator.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { processScreenshotCrossPlatform } from "./system-bar-cropper.js";
import { generateVisionMarketingCopy } from "./vision-copywriter.js";
import { buildAppStoreScreenshotsJson } from "./generate-project-state.js";
import { applyAutoThemeToProject } from "./auto-theme-detector.js";
import { detectActivePackage, formatDefaultAppName } from "./interactive-prompt.js";

function parseArgs(): { configPath: string; projectDir?: string; captureOnly: boolean; appId?: string; appName?: string } {
  const args = process.argv.slice(2);
  let configPath = path.resolve(process.cwd(), "pipeline.config.json");
  let projectDir: string | undefined;
  let captureOnly = false;
  let appId: string | undefined;
  let appName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      configPath = path.resolve(process.cwd(), args[i + 1]);
    }
    if (args[i] === "--projectDir" && args[i + 1]) {
      projectDir = path.resolve(process.cwd(), args[i + 1]);
    }
    if (args[i] === "--appId" && args[i + 1]) {
      appId = args[i + 1].trim();
    }
    if (args[i] === "--appName" && args[i + 1]) {
      appName = args[i + 1].trim();
    }
    if (args[i] === "--captureOnly") {
      captureOnly = true;
    }
  }
  return { configPath, projectDir, captureOnly, appId, appName };
}

function getAdbPath(): string {
  try {
    execSync("adb version", { stdio: "ignore" });
    return "adb";
  } catch {}

  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Android/Sdk/platform-tools/adb.exe"),
    path.join(process.env.ANDROID_HOME || "", "platform-tools/adb.exe"),
    path.join(process.env.ANDROID_SDK_ROOT || "", "platform-tools/adb.exe"),
    path.join(process.env.HOME || "", "Library/Android/sdk/platform-tools/adb"),
    path.join(process.env.HOME || "", "Android/Sdk/platform-tools/adb")
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return `"${candidate}"`;
    }
  }

  return "adb";
}

function checkLiveDevices(adbCmd: string): { hasDevice: boolean; deviceName?: string } {
  try {
    const adbOutput = execSync(`${adbCmd} devices`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
    const lines = adbOutput.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("List of devices"));
    const active = lines.find(l => l.endsWith("device"));
    if (active) {
      return { hasDevice: true, deviceName: active.split(/\s+/)[0] };
    }
  } catch {}
  return { hasDevice: false };
}

/**
 * Extracts readable visible UI text/content-desc labels from an Android uiautomator XML dump,
 * ignoring system bar elements so marketing copy matches real on-screen features.
 */
function extractVisibleUiTexts(xmlPath: string): string[] {
  if (!fs.existsSync(xmlPath)) return [];
  try {
    const xml = fs.readFileSync(xmlPath, "utf-8");
    const texts: string[] = [];
    const seen = new Set<string>();
    const nodeRegex = /<node\b([^>]+)>/g;
    let match: RegExpExecArray | null;
    while ((match = nodeRegex.exec(xml)) !== null) {
      const attrs = match[1];
      if (/package="com\.android\.systemui"/i.test(attrs)) continue;
      for (const attr of ["text", "content-desc"]) {
        const m = attrs.match(new RegExp(`${attr}="([^"]+)"`));
        if (!m) continue;
        const val = m[1].replace(/&#10;/g, " ").replace(/&amp;/g, "&").trim();
        if (!val || val.length < 2 || val.length > 60) continue;
        if (/^\d{1,2}:\d{2}$/.test(val)) continue;
        const key = val.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          texts.push(val);
        }
      }
      if (texts.length >= 25) break;
    }
    return texts;
  } catch {
    return [];
  }
}

async function runManualOperator() {
  const { configPath, projectDir: argProjectDir, captureOnly, appId: argAppId, appName: argAppName } = parseArgs();
  const adbCmd = getAdbPath();
  const { hasDevice, deviceName } = checkLiveDevices(adbCmd);

  if (!hasDevice) {
    console.error("\n❌ [No Device Connected] Please connect an Android phone with USB debugging or start an emulator.");
    process.exit(1);
  }

  let config: any = {};
  if (!argAppId && fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {}
  }

  const detectedPkg = detectActivePackage(adbCmd);
  const appId = argAppId || config?.app?.appId || detectedPkg || "my-app";
  const appName = argAppName || (argAppId ? formatDefaultAppName(argAppId) : config?.marketing?.appName) || (detectedPkg ? formatDefaultAppName(detectedPkg) : "App");

  // Launch target package if explicitly specified via --appId
  if (argAppId) {
    try {
      execSync(`${adbCmd} shell monkey -p ${argAppId} -c android.intent.category.LAUNCHER 1`, { stdio: "ignore" });
    } catch {}
  }

  if (!config.marketing) {
    config.marketing = {
      appName,
      shortDescription: "Fast, intuitive, and modern mobile experience.",
      themePreset: "clean-light",
      accentColor: "#4F46E5"
    };
  } else if (argAppName || argAppId) {
    config.marketing.appName = appName;
  }
  if (!config.app) {
    config.app = { appId, platform: "android" };
  } else {
    config.app.appId = appId;
  }

  const projectDir = argProjectDir || path.resolve(process.cwd(), "projects", appId);
  const projectScreenshotsDir = path.join(projectDir, "screenshots");
  const templateScreenshotsDir = path.resolve(process.cwd(), "template/public/screenshots");

  if (!fs.existsSync(projectScreenshotsDir)) fs.mkdirSync(projectScreenshotsDir, { recursive: true });
  if (!fs.existsSync(templateScreenshotsDir)) fs.mkdirSync(templateScreenshotsDir, { recursive: true });

  // Calculate starting index based on existing files or start fresh
  const existingFiles = fs.readdirSync(projectScreenshotsDir).filter(f => /^slide-\d+\.png$/.test(f));
  let slideIndex = 1;

  console.log("\n==========================================================");
  console.log("MANUAL OPERATOR MODE - LIVE SCREEN SNAPPER");
  console.log("==========================================================");
  console.log(`Connected Device : ${deviceName}`);
  console.log(`Target Project   : ${appId} (${appName})`);
  console.log(`Save Directory   : ${projectScreenshotsDir}`);
  console.log("----------------------------------------------------------");
  console.log("Instructions:");
  console.log("  - Navigate to any screen on your phone or emulator.");
  console.log("  - Press [+] or [Enter] in this terminal to snap the screen.");
  console.log("  - (Optional) Type a short screen name (e.g. 'clients') + [Enter].");
  console.log("  - When finished, type [done] (or [d]) to generate labels & launch editor.");
  console.log("  - Type [q] to quit without saving.");
  console.log("==========================================================\n");

  const rl = readline.createInterface({ input, output });

  // Ask whether to overwrite/start fresh or append
  if (existingFiles.length > 0) {
    const choice = await rl.question(`Found ${existingFiles.length} existing screenshot(s). Start [fresh] or [append]? [fresh]: `);
    if (choice.trim().toLowerCase() === "append") {
      slideIndex = existingFiles.length + 1;
      console.log(`✓ Continuing from Slide ${slideIndex}...\n`);
    } else {
      for (const dir of [projectScreenshotsDir, templateScreenshotsDir]) {
        for (const f of fs.readdirSync(dir)) {
          if (/^slide-\d+(?:-(?:ios|android))?\.(?:png|xml|meta\.json)$/i.test(f)) {
            try { fs.unlinkSync(path.join(dir, f)); } catch {}
          }
        }
      }
      console.log(`✓ Starting fresh from Slide 1...\n`);
    }
  } else {
    // Clear leftover template slides from any previous project
    for (const f of fs.readdirSync(templateScreenshotsDir)) {
      if (/^slide-\d+(?:-(?:ios|android))?\.(?:png|xml|meta\.json)$/i.test(f)) {
        try { fs.unlinkSync(path.join(templateScreenshotsDir, f)); } catch {}
      }
    }
  }

  const capturedSlides: string[] = [];
  const capturedGoals: { target: string; instruction: string }[] = [];

  while (true) {
    const cmd = await rl.question(`[Screen ${slideIndex}] Press (+) or [Enter] to Snap (or type screen hint / 'done'): `);
    const rawTrimmed = cmd.trim();
    const trimmed = rawTrimmed.toLowerCase();

    if (trimmed === "done" || trimmed === "d") {
      break;
    }

    if (trimmed === "q" || trimmed === "quit" || trimmed === "exit") {
      console.log("\nManual operator cancelled.");
      rl.close();
      process.exit(0);
    }

    const userHint = rawTrimmed && rawTrimmed !== "+" && rawTrimmed !== "s" && rawTrimmed !== "snap" ? rawTrimmed : "";

    // Capture screen & live Android UI XML context
    console.log(`   Snapping screen from device ${deviceName}...`);
    const fileName = `slide-${slideIndex}.png`;
    const projectDest = path.join(projectScreenshotsDir, fileName);
    const templateDest = path.join(templateScreenshotsDir, fileName);
    const xmlDest = path.join(projectScreenshotsDir, `slide-${slideIndex}.xml`);
    const metaDest = path.join(projectScreenshotsDir, `slide-${slideIndex}.meta.json`);

    try {
      let hasXml = false;
      try {
        execSync(`${adbCmd} shell uiautomator dump /sdcard/window_dump.xml`, { stdio: "ignore", timeout: 4000 });
        execSync(`${adbCmd} pull /sdcard/window_dump.xml "${xmlDest}"`, { stdio: "ignore", timeout: 4000 });
        execSync(`${adbCmd} shell rm -f /sdcard/window_dump.xml`, { stdio: "ignore" });
        hasXml = fs.existsSync(xmlDest);
      } catch {}

      execSync(`${adbCmd} shell screencap -p /sdcard/manual_snap.png`, { stdio: "ignore" });
      execSync(`${adbCmd} pull /sdcard/manual_snap.png "${projectDest}"`, { stdio: "ignore" });
      try { execSync(`${adbCmd} shell rm -f /sdcard/manual_snap.png`, { stdio: "ignore" }); } catch {}

      if (fs.existsSync(projectDest) && fs.statSync(projectDest).size > 1000) {
        fs.copyFileSync(projectDest, templateDest);

        const uiTexts = hasXml ? extractVisibleUiTexts(xmlDest) : [];
        fs.writeFileSync(metaDest, JSON.stringify({ hint: userHint, uiTexts, capturedAt: new Date().toISOString() }, null, 2), "utf-8");

        const goalTarget = userHint || uiTexts[0] || `Screen ${slideIndex}`;
        const goalInstruction = [userHint, ...uiTexts].filter(Boolean).join(" | ");
        capturedGoals.push({ target: goalTarget, instruction: goalInstruction });

        // Auto-sanitize for iOS and Android
        const projectIosDest = path.join(projectScreenshotsDir, `slide-${slideIndex}-ios.png`);
        const projectAndroidDest = path.join(projectScreenshotsDir, `slide-${slideIndex}-android.png`);
        const templateIosDest = path.join(templateScreenshotsDir, `slide-${slideIndex}-ios.png`);
        const templateAndroidDest = path.join(templateScreenshotsDir, `slide-${slideIndex}-android.png`);

        await processScreenshotCrossPlatform(projectDest, projectIosDest, projectAndroidDest, "android", hasXml ? xmlDest : undefined);
        if (fs.existsSync(projectIosDest)) fs.copyFileSync(projectIosDest, templateIosDest);
        if (fs.existsSync(projectAndroidDest)) fs.copyFileSync(projectAndroidDest, templateAndroidDest);

        capturedSlides.push(fileName);
        console.log(`   ✓ [Captured slide-${slideIndex}.png]${uiTexts.length ? ` (detected: "${uiTexts.slice(0, 3).join(' · ')}")` : ""}`);
        console.log(`     • Clean iOS variant generated (9:41 safe-area + status bar)`);
        console.log(`     • Native Android variant saved`);
        console.log(`   Total captured: ${capturedSlides.length} screen(s).\n`);
        slideIndex++;
      } else {
        console.error("   ❌ Capture failed. Ensure your screen is unlocked.");
      }
    } catch (err: any) {
      console.error("   ❌ Error during screencap:", err?.message || err);
    }
  }

  rl.close();

  if (capturedSlides.length === 0) {
    console.log("\nNo new screenshots were captured. Exiting.");
    process.exit(0);
  }

  if (capturedGoals.length > 0) {
    config.captureGoals = capturedGoals;
  }

  if (captureOnly) {
    console.log(`\n✓ Manual Capture finished. Saved ${capturedSlides.length} screen(s). Handing back to pipeline...`);
    return;
  }

  console.log(`\n==========================================================`);
  console.log(`Captured ${capturedSlides.length} screens. Generating copy...`);
  console.log(`==========================================================\n`);

  const generatedSlides = await generateVisionMarketingCopy(capturedSlides, projectScreenshotsDir, config);

  console.log("\n=== Building app-store-screenshots.json ===");
  buildAppStoreScreenshotsJson(
    appName,
    config?.marketing?.themePreset || "clean-light",
    config?.marketing?.accentColor || "#EA580C",
    generatedSlides,
    appId
  );

  // Auto-detect & apply AI color palette and matching theme
  try {
    await applyAutoThemeToProject(projectDir, path.resolve(process.cwd(), "template"));
  } catch {}

  // Sync to project folder
  try {
    const templateJsonPath = path.resolve(process.cwd(), "template/app-store-screenshots.json");
    const projectJsonPath = path.join(projectDir, "app-store-screenshots.json");
    if (fs.existsSync(templateJsonPath)) {
      fs.copyFileSync(templateJsonPath, projectJsonPath);
    }
  } catch {}

  console.log("\nManual capture complete. Starting editor at http://localhost:3000 ...");
  try {
    execSync(`npm run editor:dev`, { stdio: "inherit" });
  } catch {}
}

runManualOperator().catch(console.error);
