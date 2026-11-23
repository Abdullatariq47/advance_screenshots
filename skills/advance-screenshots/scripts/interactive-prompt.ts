// scripts/interactive-prompt.ts
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { detectAllConnectedDevices, ConnectedDevice } from "./device-detector.js";

export interface PipelineConfig {
  app: {
    platform: string;
    appId: string;
    auth: {
      hasAuth: boolean;
      credentials?: {
        email?: string;
        password?: string;
      };
      hints?: string;
    };
  };
  captureMode: "auto-lifecycle" | "manual" | "guided" | "custom";
  captureGoals: Array<{
    target: string;
    instruction: string;
  }>;
  marketing: {
    appName: string;
    shortDescription: string;
    longDescription?: string;
    themePreset: string;
    accentColor: string;
  };
}

export function detectActivePackage(adbCmd: string): string | null {
  try {
    const out = execSync(`${adbCmd} shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const match = out.match(/u0\s+([a-zA-Z0-9_\.]+)\//);
    if (
      match &&
      match[1] &&
      !match[1].startsWith("com.android.launcher") &&
      !match[1].startsWith("com.google.android.apps.nexuslauncher") &&
      !match[1].startsWith("com.sec.android.app.launcher")
    ) {
      return match[1];
    }
  } catch { }
  return null;
}

export function formatDefaultAppName(packageId: string): string {
  if (!packageId) return "My App";
  const parts = packageId
    .split(".")
    .filter((p) => p !== "com" && p !== "app" && p !== "android" && p !== "org" && p !== "io");
  const words = (parts.length > 0 ? parts : packageId.split(".")).join(" ");
  return (
    words
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || "My App"
  );
}

export async function promptPipelineConfig(
  adbCmd: string,
  existingConfig?: PipelineConfig
): Promise<{ config: PipelineConfig; projectDir: string }> {
  const rl = readline.createInterface({ input, output });

  console.log("\n==========================================================");
  console.log("Screenshot Pipeline - Project Setup Wizard");
  console.log("==========================================================");

  // Auto-detect connected iOS and Android devices
  const connectedDevices = detectAllConnectedDevices();
  const iosDevice = connectedDevices.find(d => d.platform === "ios");
  const androidDevice = connectedDevices.find(d => d.platform === "android");

  let detectedPlatform: "ios" | "android" = iosDevice ? "ios" : (androidDevice ? "android" : (process.platform === "darwin" ? "ios" : "android"));

  if (connectedDevices.length > 0) {
    console.log(`Connected Devices Detected:`);
    for (const d of connectedDevices) {
      console.log(`   • [${d.platform.toUpperCase()}] ${d.name} (${d.type})`);
    }
  }

  // Allow confirming or changing platform on macOS or when multiple devices exist
  let targetPlatform: "ios" | "android" = detectedPlatform;
  if (process.platform === "darwin" || connectedDevices.length > 1) {
    const platformAns = await rl.question(`\nTarget Platform: 1) iPhone / iOS   2) Android [${detectedPlatform === "ios" ? "1" : "2"}]: `);
    targetPlatform = platformAns.trim() === "2" ? "android" : (platformAns.trim() === "1" ? "ios" : detectedPlatform);
    console.log(`✓ Active Target Platform: ${targetPlatform === "ios" ? "iPhone / iOS" : "Android"}`);
  }

  // Auto-detect active app from connected phone (if Android)
  const detectedPackage = targetPlatform === "android" ? detectActivePackage(adbCmd) : null;
  if (detectedPackage) {
    console.log(`Live Device Active App Detected: ${detectedPackage}`);
    console.log(`   ⚡ Zero-Restart Attach: We'll snap your running app directly — session & active screen are preserved!`);
  }

  // 1. CHOOSE EXECUTION MODE FIRST
  console.log(`\n[1/3] Choose Execution Mode:`);
  console.log(`      1) [Manual Operator Mode] (Recommended)`);
  console.log(`         • Launch your app on your device freely`);
  console.log(`         • Press [+] to snap any screen at your own pace`);
  console.log(`         • No bundle ID or login credentials required!`);
  console.log(`      2) [Full Auto Lifecycle] (Autonomous AI Agent)`);
  console.log(`         • Headless agent launches package, logs in, & explores screens`);
  console.log(`         • Requires Target Package / Bundle ID & credentials`);
  console.log(`      3) [Interactive Guided Mode]`);
  console.log(`      4) [Custom Screen List]`);

  const modeAnswer = await rl.question(`      Select option (1, 2, 3, or 4) [1]: `);
  const selectedMode = modeAnswer.trim() || "1";

  // Check existing configs
  const activeSaved = existingConfig;
  const inferredAppName =
    activeSaved?.marketing?.appName ||
    (detectedPackage ? formatDefaultAppName(detectedPackage) : "My App");

  let targetAppId = detectedPackage || activeSaved?.app?.appId || "";
  let captureMode: PipelineConfig["captureMode"] = "manual";
  let hasAuth = false;
  let credentials: { email?: string; password?: string } | undefined;
  let captureGoals: PipelineConfig["captureGoals"] = [];

  // ==========================================
  // BRANCH A: MANUAL OPERATOR MODE
  // ==========================================
  if (selectedMode === "1") {
    captureMode = "manual";
    captureGoals = [];

    console.log(`\nSelected Manual Operator Mode - no bundle ID or credentials needed.`);

    // Simply ask for App Display Name
    const appNameAnswer = await rl.question(`\n[2/3] App Display Name for Store Screenshots [${inferredAppName}]: `);
    const appName = appNameAnswer.trim() || inferredAppName;

    const defaultShortDesc =
      activeSaved?.marketing?.shortDescription || "Fast, intuitive, and modern mobile experience.";
    const descAnswer = await rl.question(`[3/3] Short Marketing Tagline [${defaultShortDesc}]: `);
    const shortDescription = descAnswer.trim() || defaultShortDesc;

    rl.close();

    // Determine appId and projectDir from appName
    if (!targetAppId) {
      targetAppId = appName.toLowerCase().replace(/[^a-z0-9]/g, "-") || "my-app";
    }
    const projectDir = path.resolve(process.cwd(), "projects", targetAppId);

    const config: PipelineConfig = {
      app: {
        platform: "android",
        appId: targetAppId,
        auth: {
          hasAuth: false,
          hints: "Manual operator mode: user controls device directly.",
        },
      },
      captureMode,
      captureGoals,
      marketing: {
        appName,
        shortDescription,
        themePreset: activeSaved?.marketing?.themePreset || "clean-light",
        accentColor: activeSaved?.marketing?.accentColor || "#4F46E5",
      },
    };

    // Ensure project directory exists
    const projectScreenshotsDir = path.join(projectDir, "screenshots");
    if (!fs.existsSync(projectScreenshotsDir)) {
      fs.mkdirSync(projectScreenshotsDir, { recursive: true });
    }

    fs.writeFileSync(path.join(projectDir, "pipeline.config.json"), JSON.stringify(config, null, 2), "utf-8");
    fs.writeFileSync(path.resolve(process.cwd(), "pipeline.config.json"), JSON.stringify(config, null, 2), "utf-8");
    console.log(`\n✓ Project initialized: projects/${targetAppId}/`);

    return { config, projectDir };
  }

  // ==========================================
  // BRANCH B: AUTONOMOUS AI / GUIDED / CUSTOM
  // ==========================================
  if (selectedMode === "3") {
    captureMode = "guided";
  } else if (selectedMode === "4") {
    captureMode = "custom";
  } else {
    captureMode = "auto-lifecycle";
  }

  // Autonomous modes require target package ID to launch over ADB
  const promptText = targetAppId
    ? `\nTarget Android Package ID [${targetAppId}]: `
    : `\nTarget Android Package ID (e.g. com.example.app): `;
  const appIdAnswer = await rl.question(promptText);
  targetAppId = appIdAnswer.trim() || targetAppId;
  while (!targetAppId) {
    const retry = await rl.question(`   Package ID cannot be empty. Please enter Target Package ID: `);
    targetAppId = retry.trim();
  }

  const projectDir = path.resolve(process.cwd(), "projects", targetAppId);

  // Authentication
  const savedHasAuth = activeSaved?.app?.auth?.hasAuth ?? false;
  const authPromptLabel = savedHasAuth ? "(Y/n) [Y]" : "(y/N) [N]";
  const hasAuthAnswer = await rl.question(`\nDoes this app require automated login? ${authPromptLabel}: `);
  hasAuth = hasAuthAnswer.trim() ? hasAuthAnswer.trim().toLowerCase() === "y" : savedHasAuth;

  if (hasAuth) {
    const savedEmail = activeSaved?.app?.auth?.credentials?.email || "";
    const emailPrompt = savedEmail ? `   • Email or Username [${savedEmail}]: ` : `   • Email or Username: `;
    const emailAnswer = await rl.question(emailPrompt);
    const email = emailAnswer.trim() || savedEmail;

    const savedPass = activeSaved?.app?.auth?.credentials?.password || "";
    const passPrompt = savedPass ? `   • Password [Saved]: ` : `   • Password: `;
    const passAnswer = await rl.question(passPrompt);
    const password = passAnswer.trim() || savedPass;

    credentials = { email, password };
  }

  if (captureMode === "custom") {
    const customList = await rl.question(`\nEnter screen names (comma-separated): `);
    const names = customList.split(",").map((s) => s.trim()).filter(Boolean);
    captureGoals =
      names.length > 0
        ? names.map((n) => ({ target: n, instruction: `Capture ${n}` }))
        : [{ target: "Home Screen", instruction: "Main overview" }];
  } else {
    captureGoals = [
      { target: "Splash Screen", instruction: "Fresh launch splash" },
      ...(hasAuth ? [{ target: "Login Screen", instruction: "Sign-in credentials page" }] : []),
      { target: "Dashboard", instruction: "Primary operational overview" },
      { target: "Navigation View", instruction: "Dynamic navigation tab" },
    ];
  }

  // App Name & Tagline
  const appNameAnswer = await rl.question(`\nApp Display Name for Screenshots [${inferredAppName}]: `);
  const appName = appNameAnswer.trim() || inferredAppName;

  const defaultShortDesc =
    activeSaved?.marketing?.shortDescription || "Fast, intuitive, and modern mobile experience.";
  const descAnswer = await rl.question(`Short Marketing Tagline [${defaultShortDesc}]: `);
  const shortDescription = descAnswer.trim() || defaultShortDesc;

  rl.close();

  const config: PipelineConfig = {
    app: {
      platform: "android",
      appId: targetAppId,
      auth: {
        hasAuth,
        credentials,
        hints: "Auto-fill, validate fields, minimize keyboard, tap Login, and confirm transition to Dashboard.",
      },
    },
    captureMode,
    captureGoals,
    marketing: {
      appName,
      shortDescription,
      themePreset: activeSaved?.marketing?.themePreset || "clean-light",
      accentColor: activeSaved?.marketing?.accentColor || "#1E3A8A",
    },
  };

  const projectScreenshotsDir = path.join(projectDir, "screenshots");
  if (!fs.existsSync(projectScreenshotsDir)) {
    fs.mkdirSync(projectScreenshotsDir, { recursive: true });
  }

  fs.writeFileSync(path.join(projectDir, "pipeline.config.json"), JSON.stringify(config, null, 2), "utf-8");
  fs.writeFileSync(path.resolve(process.cwd(), "pipeline.config.json"), JSON.stringify(config, null, 2), "utf-8");
  console.log(`\n✓ Project initialized: projects/${targetAppId}/`);

  return { config, projectDir };
}
