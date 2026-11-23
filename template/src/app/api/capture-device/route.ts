// template/src/app/api/capture-device/route.ts
import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { NextResponse } from "next/server";
import { processScreenshotCrossPlatform } from "@/lib/device-cropper";
import type { Slide, Device } from "@/lib/types";

export const dynamic = "force-dynamic";

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
    path.join(process.env.HOME || "", "Android/Sdk/platform-tools/adb"),
  ];

  for (const candidate of candidates) {
    if (candidate && fsSync.existsSync(/*turbopackIgnore: true*/ candidate)) {
      return `"${candidate}"`;
    }
  }

  return "adb";
}

function checkLiveDevices(adbCmd: string): { hasDevice: boolean; deviceName?: string } {
  try {
    const adbOutput = execSync(`${adbCmd} devices`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
    const lines = adbOutput.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("List of devices"));
    const active = lines.find((l) => l.endsWith("device"));
    if (active) {
      return { hasDevice: true, deviceName: active.split(/\s+/)[0] };
    }
  } catch {}
  return { hasDevice: false };
}

export async function GET() {
  const adbCmd = getAdbPath();
  const { hasDevice, deviceName } = checkLiveDevices(adbCmd);
  return NextResponse.json({ ok: true, connected: hasDevice, deviceName });
}

export async function POST(req: Request) {
  try {
    const adbCmd = getAdbPath();
    const { hasDevice, deviceName } = checkLiveDevices(adbCmd);

    if (!hasDevice) {
      return NextResponse.json(
        {
          ok: false,
          error: "No active phone or emulator connected via ADB. Please connect your device with USB debugging enabled.",
        },
        { status: 400 }
      );
    }

    const publicScreenshotsDir = path.join(process.cwd(), "public", "screenshots");
    if (!fsSync.existsSync(publicScreenshotsDir)) {
      await fs.mkdir(publicScreenshotsDir, { recursive: true });
    }

    // Attempt to load current project and config to know appId and project folder
    const projectFilePath = path.join(process.cwd(), "app-store-screenshots.json");
    let projectState: any = null;
    if (fsSync.existsSync(projectFilePath)) {
      try {
        projectState = JSON.parse(await fs.readFile(projectFilePath, "utf-8"));
      } catch {}
    }

    let appId = "my-app";
    const rootConfigPath = path.resolve(process.cwd(), "..", "pipeline.config.json");
    if (fsSync.existsSync(rootConfigPath)) {
      try {
        const rootCfg = JSON.parse(await fs.readFile(rootConfigPath, "utf-8"));
        if (rootCfg?.app?.appId) appId = rootCfg.app.appId;
      } catch {}
    }

    const projectFolder = path.resolve(process.cwd(), "..", "projects", appId);
    const projectScreenshotsDir = path.join(projectFolder, "screenshots");
    if (!fsSync.existsSync(projectScreenshotsDir)) {
      await fs.mkdir(projectScreenshotsDir, { recursive: true });
    }

    // Determine next slide index
    const filesInPublic = (await fs.readdir(publicScreenshotsDir)).filter((f) => /^slide-\d+\.png$/.test(f));
    const filesInProject = (await fs.readdir(projectScreenshotsDir)).filter((f) => /^slide-\d+\.png$/.test(f));
    const allFiles = Array.from(new Set([...filesInPublic, ...filesInProject]));

    const numbers = allFiles.map((f) => parseInt(f.replace(/[^\d]/g, ""), 10) || 0);
    const nextIdx = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;

    // Screencap
    const rawFileName = `slide-${nextIdx}.png`;
    const tempDeviceFile = `/sdcard/snap_${Date.now()}.png`;
    const publicRawPath = path.join(publicScreenshotsDir, rawFileName);
    const projectRawPath = path.join(projectScreenshotsDir, rawFileName);

    execSync(`${adbCmd} shell screencap -p ${tempDeviceFile}`, { stdio: "ignore" });
    execSync(`${adbCmd} pull ${tempDeviceFile} "${publicRawPath}"`, { stdio: "ignore" });
    try {
      execSync(`${adbCmd} shell rm -f ${tempDeviceFile}`, { stdio: "ignore" });
    } catch {}

    if (!fsSync.existsSync(publicRawPath) || fsSync.statSync(publicRawPath).size < 1000) {
      return NextResponse.json(
        { ok: false, error: "Screen capture yielded empty file. Ensure screen is unlocked." },
        { status: 500 }
      );
    }

    // Copy raw to project screenshots
    await fs.copyFile(publicRawPath, projectRawPath);

    // Cross-platform sanitization
    const publicIosPath = path.join(publicScreenshotsDir, `slide-${nextIdx}-ios.png`);
    const publicAndroidPath = path.join(publicScreenshotsDir, `slide-${nextIdx}-android.png`);
    const projectIosPath = path.join(projectScreenshotsDir, `slide-${nextIdx}-ios.png`);
    const projectAndroidPath = path.join(projectScreenshotsDir, `slide-${nextIdx}-android.png`);

    await processScreenshotCrossPlatform(publicRawPath, publicIosPath, publicAndroidPath, "android");

    // Copy processed variants to project directory
    if (fsSync.existsSync(publicIosPath)) await fs.copyFile(publicIosPath, projectIosPath);
    if (fsSync.existsSync(publicAndroidPath)) await fs.copyFile(publicAndroidPath, projectAndroidPath);

    // Determine layout rhythm
    const layouts: Slide["layout"][] = ["device-bottom", "device-top", "hero"];
    const chosenLayout = layouts[(nextIdx - 1) % layouts.length];
    const newSlideId = `s_snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    // Build slide template
    const slideBase = {
      id: newSlideId,
      layout: chosenLayout,
      label: { en: `FEATURE ${String(nextIdx).padStart(2, "0")}` },
      headline: { en: `Screen ${nextIdx}\nCaptured Live` },
    };

    // If projectState exists, add to each device deck
    if (projectState && projectState.slidesByDevice) {
      for (const dev of Object.keys(projectState.slidesByDevice)) {
        const isIos = dev === "iphone" || dev === "ipad" || dev.startsWith("duo");
        const screenshotPath = isIos
          ? `/screenshots/slide-${nextIdx}-ios.png`
          : `/screenshots/slide-${nextIdx}-android.png`;

        projectState.slidesByDevice[dev] = [
          ...(projectState.slidesByDevice[dev] || []),
          {
            ...slideBase,
            screenshot: screenshotPath,
          },
        ];
      }

      await fs.writeFile(projectFilePath, JSON.stringify(projectState, null, 2), "utf-8");

      // Also sync to project folder
      const projectStateFolderDest = path.join(projectFolder, "app-store-screenshots.json");
      await fs.writeFile(projectStateFolderDest, JSON.stringify(projectState, null, 2), "utf-8");
    }

    const createdSlide: Slide = {
      ...slideBase,
      screenshot: `/screenshots/slide-${nextIdx}-ios.png`,
    };

    return NextResponse.json({
      ok: true,
      slideIndex: nextIdx,
      deviceName,
      slide: createdSlide,
      projectState,
    });
  } catch (err: any) {
    console.error("Device capture failed:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal server error during device capture" },
      { status: 500 }
    );
  }
}
