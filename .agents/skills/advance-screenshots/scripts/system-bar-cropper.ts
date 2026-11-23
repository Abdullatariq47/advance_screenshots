// scripts/system-bar-cropper.ts
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

export interface SystemBarInsets {
  top: number;
  bottom: number;
}

/**
 * Detect Android status bar and navigation bar insets from UI XML dump or screen dimensions.
 */
export function detectAndroidInsets(
  imageHeight: number,
  xmlPath?: string
): SystemBarInsets {
  // Attempt 1: Parse from UI hierarchy XML if available
  if (xmlPath && fs.existsSync(xmlPath)) {
    try {
      const xmlContent = fs.readFileSync(xmlPath, "utf-8");

      // Check if root content view starts below status bar
      // e.g. resource-id="android:id/content" ... or child bounds="[0,98][1080,...]"
      const contentMatch = xmlContent.match(/bounds="\[0,(\d+)\]\[\d+,(\d+)\]"/);
      if (contentMatch) {
        const topInset = parseInt(contentMatch[1], 10);
        const bottomOffset = parseInt(contentMatch[2], 10);
        const bottomInset = imageHeight > bottomOffset ? imageHeight - bottomOffset : 0;

        if (topInset > 24 && topInset < 250) {
          return {
            top: topInset,
            bottom: bottomInset > 24 && bottomInset < 250 ? bottomInset : Math.round(imageHeight * 0.046)
          };
        }
      }

      // Check for explicit system bar bounds in XML
      const statusBarMatch = xmlContent.match(/package="com\.android\.systemui"[^>]*bounds="\[0,0\]\[\d+,(\d+)\]"/);
      const navBarMatch = xmlContent.match(/package="com\.android\.systemui"[^>]*bounds="\[0,(\d+)\]\[\d+,(\d+)\]"/);

      const top = statusBarMatch ? parseInt(statusBarMatch[1], 10) : 0;
      let bottom = 0;
      if (navBarMatch) {
        const navTop = parseInt(navBarMatch[1], 10);
        const navBottom = parseInt(navBarMatch[2], 10);
        bottom = navBottom - navTop;
      }

      if (top > 24) {
        return {
          top,
          bottom: bottom > 24 ? bottom : Math.round(imageHeight * 0.046)
        };
      }
    } catch {}
  }

  // Fallback heuristic based on modern mobile aspect ratios
  // Top: Android status bar (clock/wifi/battery) is ~4.0% of height (e.g. 90-96px on 2340/2400)
  // Bottom: Set to 0 to prevent cutting into the app's in-app bottom navigation bar/tabs.
  return {
    top: Math.round(imageHeight * 0.040),
    bottom: 0
  };
}

const IPHONE_SCREEN_ASPECT = 1320 / 2868; // Apple iphone-portrait.png transparent cutout (0.46025)

/**
 * Inspects the first clean row just below topCrop and measures how much solid
 * header padding already exists before actual app UI content begins.
 */
function inspectHeaderRegion(
  rawData: Buffer,
  width: number,
  height: number,
  channels: number,
  topCrop: number
): { topRow: Buffer; inkColor: string; existingHeaderPad: number } {
  const sampleY = Math.min(height - 1, Math.max(0, topCrop));
  const rowBytes = width * channels;
  const topRow = Buffer.from(rawData.subarray(sampleY * rowBytes, (sampleY + 1) * rowBytes));

  // Average luminance across sampled columns of the header row
  let lumSum = 0;
  let samples = 0;
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 32))) {
    const p = x * channels;
    const r = topRow[p];
    const g = topRow[p + 1];
    const b = topRow[p + 2];
    lumSum += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    samples++;
  }
  const avgLum = samples > 0 ? lumSum / samples : 1;
  const inkColor = avgLum > 0.55 ? "#111827" : "#FFFFFF";

  // Find first row below sampleY where pixels diverge noticeably from sampleY's column values
  let existingHeaderPad = 0;
  const maxScan = Math.min(height - 1, sampleY + Math.round(height * 0.10));
  for (let y = sampleY + 1; y <= maxScan; y++) {
    let diffCount = 0;
    const rowOff = y * rowBytes;
    for (let x = Math.round(width * 0.08); x < Math.round(width * 0.92); x += 4) {
      const rp = x * channels;
      const p = rowOff + rp;
      if (
        Math.abs(rawData[p] - topRow[rp]) > 18 ||
        Math.abs(rawData[p + 1] - topRow[rp + 1]) > 18 ||
        Math.abs(rawData[p + 2] - topRow[rp + 2]) > 18
      ) {
        diffCount++;
      }
    }
    if (diffCount > 10) break;
    existingHeaderPad++;
  }

  return { topRow, inkColor, existingHeaderPad };
}

/**
 * Generates an Apple-compliant iOS Status Bar SVG (9:41 left, Signal/Wi-Fi/Battery right)
 * positioned strictly inside the Dynamic Island flanking ears (L: 0..39%, R: 61..100%).
 */
function buildIosStatusBarSvg(
  width: number,
  bandHeight: number,
  totalHeight: number,
  inkColor: string
): Buffer {
  // Vertical center aligned with Apple iphone-portrait.png Dynamic Island (3.38% of screen height)
  const cy = Math.min(bandHeight * 0.68, Math.round(totalHeight * 0.0338));
  const fontSize = Math.round(width * 0.037);
  const timeX = Math.round(width * 0.195);
  const rightCenterX = Math.round(width * 0.815);
  const iconScale = width / 1080;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bandHeight}" viewBox="0 0 ${width} ${bandHeight}">
  <text x="${timeX}" y="${cy}" fill="${inkColor}" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Arial, sans-serif" font-size="${fontSize}" font-weight="600" text-anchor="middle" dominant-baseline="central" letter-spacing="-0.5">9:41</text>
  <g transform="translate(${rightCenterX}, ${cy}) scale(${iconScale.toFixed(3)})" fill="${inkColor}">
    <!-- Cellular 4 bars -->
    <g transform="translate(-82, -13)">
      <rect x="0" y="16" width="6" height="9" rx="1.8"/>
      <rect x="9.5" y="12" width="6" height="13" rx="1.8"/>
      <rect x="19" y="7" width="6" height="18" rx="1.8"/>
      <rect x="28.5" y="1" width="6" height="24" rx="1.8"/>
    </g>
    <!-- Wi-Fi -->
    <g transform="translate(-32, -14)">
      <path d="M19.5 23.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z"/>
      <path d="M11.8 14.8a11 11 0 0 1 15.4 0" fill="none" stroke="${inkColor}" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M6.4 9.2a18.5 18.5 0 0 1 26.2 0" fill="none" stroke="${inkColor}" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M1.2 3.8a26 26 0 0 1 36.6 0" fill="none" stroke="${inkColor}" stroke-width="3.6" stroke-linecap="round"/>
    </g>
    <!-- Battery -->
    <g transform="translate(20, -13)">
      <rect x="0" y="1" width="52" height="24" rx="6.5" fill="none" stroke="${inkColor}" stroke-opacity="0.45" stroke-width="2.6"/>
      <rect x="4" y="5" width="44" height="16" rx="3.4" fill="${inkColor}"/>
      <path d="M55 9v8a3 3 0 0 0 3-4v0a3 3 0 0 0-3-4z" fill="${inkColor}" fill-opacity="0.5"/>
    </g>
  </g>
</svg>`;
  return Buffer.from(svg);
}

/**
 * Crops an Android screenshot to remove the Android status bar, restores a seamless
 * iOS Dynamic Island safe-area header with native 9:41 / signal / wifi / battery icons,
 * and matches Apple's exact iPhone screen aspect ratio so zero black top/bottom padding appears.
 */
export async function cropAndroidForIos(
  inputPath: string,
  outputPath: string,
  insets?: Partial<SystemBarInsets>
): Promise<{ width: number; height: number }> {
  const { data: rawData, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width || 1080;
  const height = info.height || 2340;
  const channels = info.channels || 4;

  const topCrop = insets?.top ?? Math.round(height * 0.040);
  const bottomCrop = insets?.bottom ?? 0;
  const contentHeight = Math.max(100, height - topCrop - bottomCrop);

  const { topRow, inkColor, existingHeaderPad } = inspectHeaderRegion(
    rawData,
    width,
    height,
    channels,
    topCrop
  );

  // Target iPhone 19.5:9 height matching Apple's iphone-portrait.png bezel cutout
  const targetHeight = Math.round(width / IPHONE_SCREEN_ASPECT);
  const aspectPad = Math.max(0, targetHeight - contentHeight);
  const minIslandClearance = Math.round(targetHeight * 0.064); // Dynamic Island ends at 5.23%
  const topSafePad =
    aspectPad + existingHeaderPad >= minIslandClearance
      ? aspectPad
      : Math.max(aspectPad, minIslandClearance - existingHeaderPad);

  const outHeight = topSafePad + contentHeight;
  const rowBytes = width * channels;

  // Build seamless extended top safe-area strip + clean cropped app content
  const outBuf = Buffer.allocUnsafe(width * outHeight * channels);
  for (let y = 0; y < topSafePad; y++) {
    topRow.copy(outBuf, y * rowBytes, 0, rowBytes);
  }
  rawData.copy(outBuf, topSafePad * rowBytes, topCrop * rowBytes, (topCrop + contentHeight) * rowBytes);

  const statusBarSvg = buildIosStatusBarSvg(width, topSafePad, outHeight, inkColor);

  await sharp(outBuf, { raw: { width, height: outHeight, channels } })
    .composite([{ input: statusBarSvg, top: 0, left: 0 }])
    .png({ quality: 100 })
    .toFile(outputPath);

  return { width, height: outHeight };
}

/**
 * Crops an iOS screenshot to remove the iOS Dynamic Island / notch and home indicator,
 * leaving pure clean app content ready for Google Play / Android frames.
 */
export async function cropIosForAndroid(
  inputPath: string,
  outputPath: string,
  insets?: Partial<SystemBarInsets>
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(inputPath).metadata();
  const width = metadata.width || 1179;
  const height = metadata.height || 2556;

  // iOS Dynamic Island / notch is ~5.5% of height; Home bar is ~3.8%
  const topCrop = insets?.top ?? Math.round(height * 0.055);
  const bottomCrop = insets?.bottom ?? Math.round(height * 0.038);
  const contentHeight = Math.max(100, height - topCrop - bottomCrop);

  await sharp(inputPath)
    .extract({
      left: 0,
      top: topCrop,
      width,
      height: contentHeight
    })
    .png({ quality: 100 })
    .toFile(outputPath);

  return { width, height: contentHeight };
}

/**
 * Dual processor: takes any raw screenshot, and generates both a store-compliant iOS variant
 * and a store-compliant Android variant.
 */
export async function processScreenshotCrossPlatform(
  rawImagePath: string,
  iosOutputPath: string,
  androidOutputPath: string,
  sourcePlatform: "android" | "ios" = "android",
  xmlPath?: string
): Promise<{ iosPath: string; androidPath: string }> {
  const metadata = await sharp(rawImagePath).metadata();
  const height = metadata.height || 2400;

  if (sourcePlatform === "android") {
    // 1. Android target uses original screenshot
    fs.copyFileSync(rawImagePath, androidOutputPath);

    // 2. iOS target gets sanitized crop (no Android status bar, no Android navigation bar)
    const insets = detectAndroidInsets(height, xmlPath);
    await cropAndroidForIos(rawImagePath, iosOutputPath, insets);
  } else {
    // 1. iOS target uses original screenshot
    fs.copyFileSync(rawImagePath, iosOutputPath);

    // 2. Android target gets sanitized crop (no Dynamic Island, no home indicator)
    await cropIosForAndroid(rawImagePath, androidOutputPath);
  }

  return { iosPath: iosOutputPath, androidPath: androidOutputPath };
}

