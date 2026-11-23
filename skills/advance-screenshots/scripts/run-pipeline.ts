// scripts/run-pipeline.ts
import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { buildAppStoreScreenshotsJson, SlideConfig } from "./generate-project-state.js";
import { promptPipelineConfig, PipelineConfig } from "./interactive-prompt.js";
import { generateVisionMarketingCopy } from "./vision-copywriter.js";
import { killProcessesOnPort } from "./kill-server.js";
import { applyAutoThemeToProject } from "./auto-theme-detector.js";

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

function isServerRunning(port = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 304);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function run() {
  const args = process.argv.slice(2);
  const noServer = args.includes("--no-server") || args.includes("--dry-run");
  const quickMode = args.includes("--quick") || args.includes("--skip-wizard");
  const configPath = path.resolve(process.cwd(), "pipeline.config.json");
  const adbCmd = getAdbPath();

  let existingConfig: any = null;
  if (fs.existsSync(configPath)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {}
  }

  let config: PipelineConfig;
  let projectDir: string = "";

  // Interactive runtime wizard
  if (!quickMode && process.stdin.isTTY) {
    const res = await promptPipelineConfig(adbCmd, existingConfig);
    config = res.config;
    projectDir = res.projectDir;
  } else {
    config = existingConfig;
    projectDir = path.resolve(process.cwd(), "projects", config?.app?.appId || "default-app");
  }

  if (!config) {
    console.error("Missing configuration. Please run the wizard to configure your app.");
    process.exit(1);
  }

  console.log("\n==========================================================");
  console.log("Starting Mobile App Store Screenshot Pipeline");
  console.log(`App: ${config.app.appId} (${config.app.platform})`);
  console.log(`Project Folder: ${projectDir}`);
  console.log("==========================================================\n");

  console.log("=== Step 1: Initiating Dynamic Mobile Navigation ===");
  try {
    const platformFlag = config.app?.platform ? ` --platform "${config.app.platform}"` : "";
    if (config.captureMode === "manual") {
      console.log("Manual Operator Mode: Browse the app on your device and snap screens.\n");
      execSync(`npx tsx ./scripts/manual-operator.ts --config "${configPath}" --projectDir "${projectDir}"${platformFlag} --captureOnly`, { stdio: "inherit" });
    } else {
      execSync(`npx tsx ./scripts/agent-executor.ts --config "${configPath}" --projectDir "${projectDir}"${platformFlag}`, { stdio: "inherit" });
    }
  } catch (err) {
    console.error("\n❌ [Pipeline Error] Screen capture process failed or was aborted.");
    process.exit(1);
  }

  console.log("\n=== Step 2: Analyzing Screenshots & Generating Connected Copy ===");
  const projectScreenshotsDir = path.join(projectDir, "screenshots");
  if (!fs.existsSync(projectScreenshotsDir)) {
    console.error(`\n❌ Screenshots directory not found: ${projectScreenshotsDir}`);
    process.exit(1);
  }

  const screenshotFiles = fs.readdirSync(projectScreenshotsDir)
    .filter(f => /^slide-\d+\.png$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/[^\d]/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/[^\d]/g, ""), 10) || 0;
      return numA - numB;
    });

  if (screenshotFiles.length === 0) {
    console.error(`\n❌ No screenshots found in ${projectScreenshotsDir}. Cannot proceed with copy generation.`);
    process.exit(1);
  }

  console.log(`[Copywriter Engine] Processing ${screenshotFiles.length} screenshots with Vision Marketing guidelines...`);
  const generatedSlides = await generateVisionMarketingCopy(screenshotFiles, projectScreenshotsDir, config);

  console.log("\n=== Step 3: Injecting State into app-store-screenshots.json ===");
  buildAppStoreScreenshotsJson(
    config?.marketing?.appName || config?.app?.appId?.split(".").pop()?.toUpperCase() || "MY APP",
    config?.marketing?.themePreset || "clean-light",
    config?.marketing?.accentColor || "#4F46E5",
    generatedSlides,
    config?.app?.appId
  );

  // Auto-detect & apply AI color palette and matching theme
  try {
    await applyAutoThemeToProject(projectDir, path.resolve(process.cwd(), "template"));
  } catch {}

  // Also save a copy inside the dedicated project folder
  try {
    const templateJsonPath = path.resolve(process.cwd(), "template/app-store-screenshots.json");
    const projectJsonPath = path.join(projectDir, "app-store-screenshots.json");
    if (fs.existsSync(templateJsonPath)) {
      fs.copyFileSync(templateJsonPath, projectJsonPath);
    }
  } catch {}

  console.log("\n==========================================================");
  console.log("Pipeline completed.");
  console.log(`📁 Project Folder: ${projectDir}`);
  console.log(`🖼 Screenshots: ${screenshotFiles.length} rendered & saved`);
  console.log(`📄 State Config: ${path.join(projectDir, "app-store-screenshots.json")}`);
  console.log("==========================================================");

  if (noServer) {
    console.log("[Pipeline] Run finished in non-server mode. To launch the editor, run: npm run editor:dev");
    return;
  }

  console.log("\n=== Step 4: Booting Next.js Interactive Editor Canvas ===");
  // Automatically check and kill any existing open servers on port 3000/3001
  const serverAlreadyRunning = await isServerRunning(3000);
  if (serverAlreadyRunning) {
    console.log("🔄 Detected existing open server on port 3000. Terminating to start fresh...");
    killProcessesOnPort(3000);
    killProcessesOnPort(3001);
    await new Promise(r => setTimeout(r, 600));
  }

  const templateDir = path.resolve(process.cwd(), "template");
  console.log("\n==========================================================");
  console.log("Editor starting at: http://localhost:3000");
  console.log("All screenshots, connected layouts, and text are preloaded.");
  console.log("Press [Ctrl+C] in this terminal to stop the editor.");
  console.log("==========================================================\n");

  const nextBin = path.resolve(templateDir, "node_modules/next/dist/bin/next");
  const server = fs.existsSync(nextBin)
    ? spawn(process.execPath, [nextBin, "dev"], { cwd: templateDir, stdio: "inherit" })
    : spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], { cwd: templateDir, stdio: "inherit", shell: true });

  const cleanupAndExit = () => {
    console.log("\n🛑 Terminal terminated. Killing open server and releasing ports...");
    if (server && server.pid) {
      try {
        execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: "ignore" });
      } catch {}
    }
    killProcessesOnPort(3000);
    killProcessesOnPort(3001);
    process.exit(0);
  };

  process.on("SIGINT", cleanupAndExit);
  process.on("SIGTERM", cleanupAndExit);
  process.on("exit", () => {
    if (server && server.pid) {
      try {
        execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: "ignore" });
      } catch {}
    }
    killProcessesOnPort(3000);
  });
}



run().catch(err => {
  console.error("Pipeline failure:", err);
  process.exit(1);
});
