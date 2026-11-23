// template/src/lib/device-cropper.ts
import sharp from "sharp";
import * as fs from "fs";

export interface SystemBarInsets {
  top: number;
  bottom: number;
}

/**
 * Standard Android status bar (~4.0%) crop, preserving in-app bottom navigation bar
 */
export function getAndroidInsets(height: number): SystemBarInsets {
  return {
    top: Math.round(height * 0.040),
    bottom: 0,
  };
}

/**
 * Crop status bar for Apple App Store / iPhone compliance, keeping bottom nav bar intact
 */
export async function cropAndroidForIos(
  inputPath: string,
  outputPath: string,
  insets?: Partial<SystemBarInsets>
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(inputPath).metadata();
  const width = metadata.width || 1080;
  const height = metadata.height || 2400;

  const defaultInsets = getAndroidInsets(height);
  const topInset = insets?.top ?? defaultInsets.top;
  const bottomInset = insets?.bottom ?? 0;

  const croppedHeight = Math.max(100, height - topInset - bottomInset);

  await sharp(inputPath)
    .extract({
      left: 0,
      top: topInset,
      width,
      height: croppedHeight,
    })
    .toFile(outputPath);

  return { width, height: croppedHeight };
}

/**
 * Generates both iOS (status/nav bars removed) and Android (native) variants
 */
export async function processScreenshotCrossPlatform(
  rawPath: string,
  iosOutputPath: string,
  androidOutputPath: string,
  sourcePlatform: "android" | "ios" = "android"
) {
  if (sourcePlatform === "android") {
    // 1. Android variant keeps full screen
    fs.copyFileSync(rawPath, androidOutputPath);

    // 2. iOS variant removes Android status bar & navigation bar
    await cropAndroidForIos(rawPath, iosOutputPath);
  } else {
    // iOS source
    fs.copyFileSync(rawPath, iosOutputPath);
    fs.copyFileSync(rawPath, androidOutputPath);
  }
}

