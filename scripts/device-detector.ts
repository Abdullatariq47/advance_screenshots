// scripts/device-detector.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface ConnectedDevice {
  platform: "android" | "ios";
  type: "physical" | "simulator" | "emulator";
  name: string;
  id: string;
  adbCmd?: string;
}

export function getAdbPath(): string {
  try {
    execSync("adb version", { stdio: "ignore" });
    return "adb";
  } catch { }

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

/**
 * Detects all connected Android devices, iOS Simulators, and physical iPhones.
 */
export function detectAllConnectedDevices(): ConnectedDevice[] {
  const devices: ConnectedDevice[] = [];
  const isMac = process.platform === "darwin";

  // 1. Detect iOS Devices on macOS
  if (isMac) {
    // 1a. Check for Booted iOS Simulator
    try {
      const simOut = execSync("xcrun simctl list devices", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
      const lines = simOut.split("\n");
      for (const line of lines) {
        if (line.includes("(Booted)")) {
          const match = line.match(/^\s*(.+?)\s+\(([A-F0-9-]+)\)\s+\(Booted\)/i);
          if (match) {
            devices.push({
              platform: "ios",
              type: "simulator",
              name: `${match[1].trim()} (Simulator)`,
              id: match[2].trim()
            });
          }
        }
      }
    } catch { }

    // 1b. Check for Physical iPhone via devicectl or idevice_id
    try {
      const devOut = execSync("xcrun devicectl list devices 2>/dev/null || true", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
      const lines = devOut.split("\n");
      for (const line of lines) {
        if (/iphone|ipad/i.test(line) && /connected|online/i.test(line)) {
          const parts = line.split(/\s{2,}/);
          const name = parts[0]?.trim() || "iPhone";
          const id = parts[1]?.trim() || "connected-iphone";
          devices.push({
            platform: "ios",
            type: "physical",
            name: `${name} (Physical iPhone)`,
            id
          });
        }
      }
    } catch { }

    // 1c. Fallback for physical iPhone: idevice_id from libimobiledevice
    if (!devices.some(d => d.platform === "ios" && d.type === "physical")) {
      try {
        const idOut = execSync("idevice_id -l 2>/dev/null || true", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
        if (idOut) {
          const uids = idOut.split("\n").map(u => u.trim()).filter(Boolean);
          for (const uid of uids) {
            devices.push({
              platform: "ios",
              type: "physical",
              name: `Physical iPhone (${uid.slice(0, 8)}...)`,
              id: uid
            });
          }
        }
      } catch { }
    }
  }

  // 2. Detect Android Devices & Emulators via ADB
  const adbCmd = getAdbPath();
  try {
    const adbOutput = execSync(`${adbCmd} devices -l`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
    const lines = adbOutput.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("List of devices"));
    for (const line of lines) {
      if (line.includes("device") && !line.includes("offline")) {
        const parts = line.split(/\s+/);
        const id = parts[0];
        const isEmulator = id.startsWith("emulator-");
        const modelMatch = line.match(/model:([^\s]+)/);
        const modelName = modelMatch ? modelMatch[1].replace(/_/g, " ") : (isEmulator ? "Android Emulator" : "Android Phone");
        devices.push({
          platform: "android",
          type: isEmulator ? "emulator" : "physical",
          name: `${modelName} (${id})`,
          id,
          adbCmd
        });
      }
    }
  } catch { }

  return devices;
}

/**
 * Returns the best connected device for the target platform.
 */
export function getDefaultDevice(targetPlatform?: "ios" | "android"): ConnectedDevice | null {
  const all = detectAllConnectedDevices();
  if (targetPlatform) {
    const match = all.find(d => d.platform === targetPlatform);
    if (match) return match;
  }
  return all[0] || null;
}

/**
 * Captures a raw screenshot from the designated device.
 */
export async function captureDeviceScreenshot(device: ConnectedDevice, destPath: string): Promise<boolean> {
  try {
    if (device.platform === "ios") {
      if (device.type === "simulator") {
        execSync(`xcrun simctl io ${device.id || "booted"} screenshot "${destPath}"`, { stdio: "ignore" });
        return fs.existsSync(destPath) && fs.statSync(destPath).size > 1000;
      } else {
        // Physical iPhone
        try {
          execSync(`idevicescreenshot "${destPath}"`, { stdio: "ignore" });
          return fs.existsSync(destPath) && fs.statSync(destPath).size > 1000;
        } catch {
          try {
            execSync(`pymobiledevice3 screenshot "${destPath}"`, { stdio: "ignore" });
            return fs.existsSync(destPath) && fs.statSync(destPath).size > 1000;
          } catch {}
        }

        console.error("\n❌ [Physical iPhone USB Capture Setup]");
        console.error("   To capture screenshots directly from a physical iPhone connected via USB on macOS:");
        console.error("   👉 Run: brew install libimobiledevice");
        console.error("   (Or use the iOS Simulator via 'open -a Simulator', which captures directly via xcrun)\n");
        return false;
      }
    } else {
      // Android
      const adbCmd = device.adbCmd || getAdbPath();
      execSync(`${adbCmd} -s ${device.id} shell screencap -p /sdcard/adv_snap.png`, { stdio: "ignore" });
      execSync(`${adbCmd} -s ${device.id} pull /sdcard/adv_snap.png "${destPath}"`, { stdio: "ignore" });
      try { execSync(`${adbCmd} -s ${device.id} shell rm -f /sdcard/adv_snap.png`, { stdio: "ignore" }); } catch { }
      return fs.existsSync(destPath) && fs.statSync(destPath).size > 1000;
    }
  } catch (err) {
    console.warn(`   ⚠ Failed capturing from ${device.name}:`, err);
  }
  return false;
}

/**
 * Launches an application on the designated device.
 */
export function launchDeviceApp(device: ConnectedDevice, appId: string): boolean {
  try {
    if (device.platform === "ios") {
      if (device.type === "simulator") {
        execSync(`xcrun simctl launch ${device.id || "booted"} ${appId}`, { stdio: "ignore" });
        return true;
      }
    } else {
      const adbCmd = device.adbCmd || getAdbPath();
      execSync(`${adbCmd} -s ${device.id} shell monkey -p ${appId} -c android.intent.category.LAUNCHER 1`, { stdio: "ignore" });
      return true;
    }
  } catch { }
  return false;
}

